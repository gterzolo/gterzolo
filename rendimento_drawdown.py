"""
Calcola il rendimento massimo e il drawdown massimo degli ultimi N anni
(default 30) per uno o più titoli/indici, usando i dati di Yahoo Finance.

Metriche calcolate:
  - Rendimento totale e CAGR (rendimento annuo composto) del periodo
  - Rendimento massimo (max run-up): il massimo guadagno da un minimo
    a un massimo successivo
  - Drawdown massimo: la massima perdita da un massimo a un minimo successivo
  - Anno migliore e anno peggiore (rendimento per anno solare)

Simulazione "fuori dal mercato" (--fuori FILE):
  il file elenca gli intervalli in cui si è liquidi, uno per riga, con due
  date GG/MM/AAAA o AAAA-MM-GG (es. "da 2006-07-13 a 2006-09-07");
  il testo dopo # e le righe vuote sono ignorati.
  Si vende alla chiusura della data di inizio e si rientra alla chiusura della
  data di fine: nei giorni intermedi il rendimento è zero (liquidità senza
  interessi, nessun costo di transazione). Le metriche sono calcolate sia
  sulla strategia sia sul semplice buy & hold, per confronto.

Uso:
    pip install yfinance pandas
    python rendimento_drawdown.py                      # S&P 500, Dow Jones e Nasdaq
    python rendimento_drawdown.py AAPL ^FTSEMIB.MI     # ticker a scelta
    python rendimento_drawdown.py ^DJI --anni 20
    python rendimento_drawdown.py --dal 14/04/2005 --fuori intervalli_fuori.txt
"""

import argparse
import re
from datetime import date

import pandas as pd
import yfinance as yf


FORMATI_DATA = ("%d/%m/%Y", "%Y-%m-%d")
REGEX_DATA = re.compile(r"\d{4}-\d{1,2}-\d{1,2}|\d{1,2}/\d{1,2}/\d{4}")


def leggi_data(testo: str) -> pd.Timestamp:
    """Accetta GG/MM/AAAA oppure AAAA-MM-GG."""
    for formato in FORMATI_DATA:
        try:
            return pd.to_datetime(testo.strip(), format=formato)
        except ValueError:
            pass
    raise ValueError(f"data non valida: {testo!r}")


def leggi_intervalli(percorso: str) -> list[tuple[pd.Timestamp, pd.Timestamp]]:
    """Legge un intervallo per riga: le prime due date trovate sono inizio e fine."""
    intervalli = []
    with open(percorso, encoding="utf-8") as f:
        for n, riga in enumerate(f, 1):
            riga = riga.split("#")[0].strip()
            if not riga:
                continue
            date_riga = REGEX_DATA.findall(riga)
            if len(date_riga) != 2:
                raise SystemExit(f"{percorso}:{n}: servono due date "
                                 f"(GG/MM/AAAA o AAAA-MM-GG): {riga!r}")
            try:
                inizio, fine = (leggi_data(d) for d in date_riga)
            except ValueError as e:
                raise SystemExit(f"{percorso}:{n}: {e}")
            if fine < inizio:
                raise SystemExit(f"{percorso}:{n}: la data di fine precede l'inizio")
            intervalli.append((inizio, fine))
    return sorted(intervalli)


def scarica_prezzi(ticker: str, inizio: pd.Timestamp) -> pd.Series:
    """Scarica i prezzi di chiusura (rettificati per dividendi e split)."""
    oggi = pd.Timestamp(date.today())
    dati = yf.download(ticker, start=inizio, end=oggi + pd.Timedelta(days=1),
                       auto_adjust=True, progress=False)
    if dati.empty:
        raise ValueError(f"Nessun dato trovato per {ticker}")
    prezzi = dati["Close"]
    if isinstance(prezzi, pd.DataFrame):
        prezzi = prezzi.iloc[:, 0]
    return prezzi.dropna()


def applica_uscite(prezzi: pd.Series, intervalli) -> tuple[pd.Series, float]:
    """
    Curva del capitale di chi è fuori dal mercato negli intervalli dati
    (rendimento zero da inizio escluso a fine inclusa). Restituisce la curva
    (stessa scala dei prezzi) e la quota di giorni investiti.
    """
    rendimenti = prezzi.pct_change().fillna(0)
    fuori = pd.Series(False, index=prezzi.index)
    for inizio, fine in intervalli:
        fuori |= (prezzi.index > inizio) & (prezzi.index <= fine)
    rendimenti[fuori] = 0.0
    curva = prezzi.iloc[0] * (1 + rendimenti).cumprod()
    return curva, 1 - fuori.iloc[1:].mean()


def drawdown_massimo(prezzi: pd.Series) -> dict:
    """Massima perdita percentuale da un picco al minimo successivo."""
    picchi = prezzi.cummax()
    drawdown = prezzi / picchi - 1
    data_minimo = drawdown.idxmin()
    data_picco = prezzi.loc[:data_minimo].idxmax()
    # Data di recupero: primo giorno in cui il prezzo torna sopra il picco
    dopo = prezzi.loc[data_minimo:]
    recuperato = dopo[dopo >= prezzi.loc[data_picco]]
    data_recupero = recuperato.index[0] if not recuperato.empty else None
    return {
        "valore": drawdown.min(),
        "picco": data_picco,
        "minimo": data_minimo,
        "recupero": data_recupero,
    }


def rendimento_massimo(prezzi: pd.Series) -> dict:
    """Massimo guadagno percentuale da un minimo al massimo successivo."""
    minimi = prezzi.cummin()
    runup = prezzi / minimi - 1
    data_massimo = runup.idxmax()
    data_minimo = prezzi.loc[:data_massimo].idxmin()
    return {
        "valore": runup.max(),
        "minimo": data_minimo,
        "massimo": data_massimo,
    }


def rendimenti_annuali(prezzi: pd.Series) -> pd.Series:
    """Rendimento per anno solare (il primo e l'ultimo anno possono essere parziali)."""
    fine_anno = prezzi.groupby(prezzi.index.year).last()
    inizio = pd.Series([prezzi.iloc[0]], index=[fine_anno.index[0] - 1])
    return pd.concat([inizio, fine_anno]).pct_change().dropna()


def stampa_metriche(titolo: str, prezzi: pd.Series) -> None:
    inizio, fine = prezzi.index[0], prezzi.index[-1]
    durata_anni = (fine - inizio).days / 365.25

    totale = prezzi.iloc[-1] / prezzi.iloc[0] - 1
    cagr = (1 + totale) ** (1 / durata_anni) - 1
    dd = drawdown_massimo(prezzi)
    ru = rendimento_massimo(prezzi)
    annuali = rendimenti_annuali(prezzi)

    f = lambda d: d.strftime("%d/%m/%Y")
    print(f"\n=== {titolo}  ({f(inizio)} - {f(fine)}, {durata_anni:.1f} anni) ===")
    print(f"Rendimento totale:     {totale:+.2%}")
    print(f"CAGR (annuo composto): {cagr:+.2%}")
    print(f"Rendimento massimo:    {ru['valore']:+.2%}  "
          f"(dal minimo del {f(ru['minimo'])} al massimo del {f(ru['massimo'])})")
    recupero = f(dd["recupero"]) if dd["recupero"] is not None else "non ancora recuperato"
    print(f"Drawdown massimo:      {dd['valore']:+.2%}  "
          f"(dal picco del {f(dd['picco'])} al minimo del {f(dd['minimo'])}, "
          f"recupero: {recupero})")
    print(f"Anno migliore:         {annuali.idxmax()}  {annuali.max():+.2%}")
    print(f"Anno peggiore:         {annuali.idxmin()}  {annuali.min():+.2%}")


def analizza(ticker: str, inizio: pd.Timestamp, intervalli) -> None:
    prezzi = scarica_prezzi(ticker, inizio)
    if not intervalli:
        stampa_metriche(ticker, prezzi)
        return
    curva, investito = applica_uscite(prezzi, intervalli)
    stampa_metriche(f"{ticker} - buy & hold", prezzi)
    stampa_metriche(f"{ticker} - con uscite dal mercato", curva)
    print(f"Tempo investito:       {investito:.1%} dei giorni di borsa")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("ticker", nargs="*", default=["^GSPC", "^DJI", "^IXIC"],
                        help="Ticker Yahoo Finance (default: ^GSPC ^DJI ^IXIC)")
    parser.add_argument("--anni", type=int, default=30,
                        help="Numero di anni da analizzare (default: 30)")
    parser.add_argument("--dal", type=leggi_data,
                        help="Data di inizio GG/MM/AAAA (sostituisce --anni)")
    parser.add_argument("--fuori", metavar="FILE",
                        help="File con gli intervalli fuori dal mercato")
    args = parser.parse_args()

    inizio = args.dal or pd.Timestamp(date.today()) - pd.DateOffset(years=args.anni)
    intervalli = leggi_intervalli(args.fuori) if args.fuori else []

    for t in args.ticker:
        try:
            analizza(t, inizio, intervalli)
        except ValueError as e:
            print(f"\n{e}")


if __name__ == "__main__":
    main()

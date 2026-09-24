"""
Calcola il rendimento massimo e il drawdown massimo degli ultimi N anni
(default 30) per uno o più titoli/indici, usando i dati di Yahoo Finance.

Metriche calcolate:
  - Rendimento totale e CAGR (rendimento annuo composto) del periodo
  - Rendimento massimo (max run-up): il massimo guadagno da un minimo
    a un massimo successivo
  - Drawdown massimo: la massima perdita da un massimo a un minimo successivo
  - Anno migliore e anno peggiore (rendimento per anno solare)

Uso:
    pip install yfinance pandas
    python rendimento_drawdown.py                      # S&P 500, Dow Jones e Nasdaq
    python rendimento_drawdown.py AAPL ^FTSEMIB.MI     # ticker a scelta
    python rendimento_drawdown.py ^DJI --anni 20
"""

import argparse
from datetime import date

import pandas as pd
import yfinance as yf


def scarica_prezzi(ticker: str, anni: int) -> pd.Series:
    """Scarica i prezzi di chiusura (rettificati per dividendi e split)."""
    oggi = pd.Timestamp(date.today())
    inizio = oggi - pd.DateOffset(years=anni)
    dati = yf.download(ticker, start=inizio, end=oggi + pd.Timedelta(days=1),
                       auto_adjust=True, progress=False)
    if dati.empty:
        raise ValueError(f"Nessun dato trovato per {ticker}")
    prezzi = dati["Close"]
    if isinstance(prezzi, pd.DataFrame):
        prezzi = prezzi.iloc[:, 0]
    return prezzi.dropna()


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


def analizza(ticker: str, anni: int) -> None:
    prezzi = scarica_prezzi(ticker, anni)
    inizio, fine = prezzi.index[0], prezzi.index[-1]
    durata_anni = (fine - inizio).days / 365.25

    totale = prezzi.iloc[-1] / prezzi.iloc[0] - 1
    cagr = (1 + totale) ** (1 / durata_anni) - 1
    dd = drawdown_massimo(prezzi)
    ru = rendimento_massimo(prezzi)
    annuali = rendimenti_annuali(prezzi)

    f = lambda d: d.strftime("%d/%m/%Y")
    print(f"\n=== {ticker}  ({f(inizio)} - {f(fine)}, {durata_anni:.1f} anni) ===")
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


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("ticker", nargs="*", default=["^GSPC", "^DJI", "^IXIC"],
                        help="Ticker Yahoo Finance (default: ^GSPC ^DJI ^IXIC)")
    parser.add_argument("--anni", type=int, default=30,
                        help="Numero di anni da analizzare (default: 30)")
    args = parser.parse_args()

    for t in args.ticker:
        try:
            analizza(t, args.anni)
        except ValueError as e:
            print(f"\n{e}")


if __name__ == "__main__":
    main()

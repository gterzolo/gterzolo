# Correzione modi

App web per la **correzione attiva della stanza** con più diffusori, ispirata a Dirac ART
(Active Room Treatment). Gira tutta nel browser: misura, calcolo dei filtri ed export per
[CamillaDSP](https://github.com/HEnquist/camilladsp).

> Non è Dirac e non ne usa il codice (che è proprietario). Implementa lo stesso principio,
> che è pubblico: ottimizzare insieme tutti i diffusori nei bassi.

## Come funziona

1. **Misura**: uno sweep esponenziale per ogni uscita (L, R, SW1, SW2), in 3–9 posizioni
   attorno al punto d'ascolto, con un microfono USB calibrato (es. UMIK-1). La risposta
   all'impulso si ricava per deconvoluzione. In alternativa si importano WAV esportati da REW
   (`p1_L.wav`, `p2_SW1.wav`, …), oppure si usa la stanza demo simulata.
2. **Correzione del singolo diffusore**: media spaziale, smoothing psicoacustico, filtro a fase
   minima verso la curva target, con un limite al boost.
3. **ART (sotto ~150 Hz)**: per ogni ingresso c e per ogni bin di frequenza si risolve un
   problema ai minimi quadrati regolarizzato (Tikhonov) su **tutte** le uscite:

   `min Σ_p w_p |Σ_k H_pk·W_ck − D_pc|² + Σ_k λ_k |W_ck − W0_ck|²`

   dove `D_pc` è il target con il ritardo del suono diretto del diffusore c più un ritardo di
   modellazione. Gli altri diffusori e i sub emettono quindi il segnale che annulla le onde
   stazionarie: si appiattisce la risposta in più posizioni e si accorcia il decadimento dei
   modi. Un vincolo per bin limita il guadagno, così le antirisonanze non vengono riempite a
   forza di boost.
4. **Export**: FIR float a 32 bit per ogni coppia ingresso→uscita, più un `camilladsp.yml`
   (v3) con la matrice `split → convoluzioni → sum`. I filtri sono già normalizzati contro il
   clipping.
5. **Verifica**: la riproduzione passa per i filtri calcolati, si misura di nuovo e la curva
   misurata viene sovrapposta a quella prevista.

## Requisiti per misurare

- Chrome o Edge, con un'interfaccia audio multicanale come uscita di sistema: il browser deve
  vedere almeno 3–4 canali. L'ordine delle uscite segue quello dei canali dell'interfaccia.
- Un microfono di misura USB e il suo file di calibrazione.
- La pagina va servita da `localhost` o in HTTPS, altrimenti il browser nega il microfono.

## Sviluppo

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # test del DSP (FFT, deconvoluzione, solutore, ART su stanza simulata)
npm run build    # produce dist/, una pagina statica pubblicabile ovunque
```

## Struttura

| File | Contenuto |
|---|---|
| `src/dsp/art.ts` | algoritmo ART multi-diffusore e previsione del risultato |
| `src/dsp/sweep.ts` | sweep esponenziale e deconvoluzione |
| `src/dsp/simulate.ts` | stanza simulata con il metodo delle sorgenti immagine |
| `src/audio/measure.ts` | misura via Web Audio (AudioWorklet allineato ai frame) |
| `src/io/camilla.ts` | generazione della configurazione CamillaDSP |
| `src/main.ts` | interfaccia |

## Limiti noti

- Correzione solo per sistemi 2.1/2.2 (ingressi L e R).
- I filtri sono validi finché diffusori, sub e punto d'ascolto restano dove sono stati misurati.
- Nei bassi resta un po' di pre-ringing (circa −15/−20 dB): si riduce abbassando il ritardo
  di modellazione o aumentando la regolarizzazione.

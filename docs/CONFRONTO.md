# Vesuvio e Unova Pocket: confronto

Regola seguita in tutto il documento: **✅ verificato** = c'è un test automatico ripetibile nel
repository; **🔧 implementato** = c'è il codice ma non una prova sul caso reale; **❓ ipotesi** = ragionamento
non ancora dimostrato. Nessuna prova è stata fatta su iPhone/iPad reali né con ROM commerciali (Pokémon
compreso): i test girano in Chromium su Linux con due ROM homebrew scritte da zero
([tools/make_test_rom.py](../tools/make_test_rom.py)).

Le informazioni su Unova Pocket vengono solo dalla descrizione ricevuta: non ho visto il suo codice.

---

## 1. Funzioni: equivalenti, migliori, assenti

| Funzione | Unova Pocket | Vesuvio |
|---|---|---|
| Base di emulazione | EmulatorJS 4.2.3 + melonDS, menu di EmulatorJS nascosto | Stessi core di EmulatorJS 4.2.3 ma **pilotati direttamente** da un motore proprio (`js/engine.js`): nessuna interfaccia EmulatorJS da nascondere |
| Sistemi | DS | DS, GBA, GB, GBC; per il DS 3 motori a scelta (melonDS, DeSmuME 2015, DeSmuME) |
| Touch DS | tocco diretto | **migliore** ✅: modalità assoluta (quella predefinita "Mouse" usa spostamenti relativi e può sfasarsi) + correzione di un difetto del frontend che spostava il tocco sugli schermi ad alta densità (iPhone/iPad). Test a densità 1×/2×/3×, con trascinamento e in vista «solo touch» |
| Croce direzionale | scorrevole o analogico | equivalente, con diagonali strette (30°) per i giochi a griglia; test del trascinamento e del multi-touch ✅ |
| Viste schermi | Gioco / Touch / Entrambi | equivalente, con scelta separata per verticale e orizzontale |
| Temi | più palette, tema Napoli | equivalente (8 temi, Napoli compreso) |
| Riconoscimento ROM | gioco/revisione | equivalente + icona e titolo italiano dal banner del DS, ROM dentro `.zip` ✅ |
| Turbo | velocità selezionabili, velocità effettiva | equivalente + misura del massimo del dispositivo, modalità «tieni premuto», audio silenziato in turbo |
| Salvataggi locali | backup ogni 30 s, copie per sessione e pre-ripristino | **migliore**: autosalvataggi «con controllo di salute», miniature, `.sav` versionato, quote separate (vedi §2) ✅ |
| Cloud | 3 punti cloud per utente/gioco, controllo versione | **assente** (scelta): trasferimento con backup `.zip` via AirDrop/iCloud/WhatsApp, senza account |
| Blocchi | contatore fotogrammi fermo 15 s, errori Wasm/WebGL | **migliore**: anche il blocco con emulatore attivo (es. schermo nero) ✅ |
| Diagnostica | — | velocità minuto per minuto, durata salvataggi, blocchi, rapporto esportabile |
| Offline | non indicato | ✅ dopo la prima apertura |
| Test | interfaccia, backup, conflitti cloud, import, turbo, arresti, core con ROM homebrew | 13 unitari + 21 end-to-end con i core veri + test di durata (§6) |

## 2. Salvataggi, cloud, 401, conflitti, ripristino

**Tipi di dato.** *Stato* = fotografia completa dell'emulatore (dipende dal motore). *Salvataggio del gioco*
(`.sav`) = quello fatto dal menu del gioco (portabile tra emulatori, ma fermo all'ultimo salvataggio).

**Salvataggi automatici** (`js/session.js`), ogni 30 s, ma solo se tutte queste condizioni sono vere:
- il gioco gira da almeno 15 s **e** 300 fotogrammi dall'avvio o dall'ultimo ripristino ✅ — evita proprio
  il caso dello stato «con 4 fotogrammi» catturato durante un riavvio;
- il giocatore ha premuto qualcosa dall'ultimo salvataggio ✅ — restare fermi non fa scorrere via gli stati buoni;
- nessun blocco sospetto in corso ✅; pagina visibile; motore attivo.

Ogni stato ha **miniatura** (fotogramma del core), tempo di gioco, motore e versione del motore, checksum
(verificato al caricamento), e viene compresso con gzip. Quote separate: 12 automatici (6 minuti),
12 checkpoint (uno ogni 10 minuti, 2 ore), 10 fine sessione, 6 copie di sicurezza; **manuali e importati non
vengono mai cancellati in automatico**; ogni stato si può «proteggere». Quando l'app va in secondo piano
(iPhone che cambia app) viene salvato lo stato «fine sessione».

**`.sav`**: ogni 10 s (e a ogni salvataggio manuale o uscita) Vesuvio legge il salvataggio interno; se è
cambiato ne conserva una **nuova versione** con data e ora (30 versioni) ✅ (test GBA: due salvataggi fatti
dal gioco → due versioni, la prima resta). Una versione vecchia si può rimettere in uso: viene aggiunta come
nuova, non sovrascrive.

**Ripristino senza perdere la partita più recente**: prima di caricare uno stato, la partita in corso
viene copiata tra le «copie di sicurezza» ✅. Dopo un ripristino riparte il periodo di riscaldamento ✅.
Il caricamento è confermato: il motore applica lo stato al fotogramma successivo e Vesuvio aspetta che
accada (ho trovato e corretto un difetto in cui cancellare subito il file temporaneo faceva fallire il
ripristino in silenzio) ✅.

**Cloud e 401.** Vesuvio non ha cloud né account: non esistono 401, accessi scaduti o finestre «accedi in
una nuova scheda». Il trasferimento si fa con un backup `.zip` per gioco (o di tutti i giochi): su iPhone/iPad
si apre il foglio di condivisione (AirDrop, «Salva su File»/iCloud Drive, WhatsApp, e-mail).
**Conflitti**: un backup importato non sovrascrive mai nulla. Gli stati finiscono tra gli «Importati» e non
vengono usati finché non li scegli; i duplicati (stesso checksum) vengono saltati; i `.sav` vengono aggiunti
come versioni ✅. È meno automatico di un cloud vero: è il compromesso per avere zero problemi di accesso.
❓ Sul 401 di Unova Pocket: il sintomo «Accedi in una nuova scheda» su iPad fa pensare a una sessione basata
su cookie di terze parti o su un popup, che Safari (ITP) blocca o cancella dopo pochi giorni; è un'ipotesi.

## 3. Turbo

**Come funziona**: è il fast-forward di RetroArch dentro il core. Il core esegue più fotogrammi emulati per
ogni fotogramma mostrato, quindi accelera **tutto il sistema emulato**: processore, animazioni, dialoghi,
musica e timer di gioco, non solo alcuni aspetti. Durante il turbo i fotogrammi in eccesso non vengono
disegnati (`fastforward_frameskip`) per risparmiare lavoro. L'audio è silenziato di default perché, accelerato,
gracchia (si può riattivare). Il nuovo rapporto viene applicato spegnendo e riaccendendo il fast-forward
(stesso comportamento del core descritto per Unova Pocket) e viene riapplicato dopo pausa, ripristino e
ritorno dal secondo piano.

**Limite**: il turbo non può superare la potenza del dispositivo. Il core web non ha JIT ARM e usa un solo
thread per l'emulazione: se il dispositivo riesce a emulare il DS solo a ×1,3, chiedere ×5 dà ×1,3.
Per questo Vesuvio mostra sempre la velocità **reale** e ha «Misura il turbo massimo» (3 secondi di turbo
illimitato nella scena corrente).

**Misure (✅, ma su un server Linux con grafica software, non su iPad):**
- GBA (mGBA): ×2 richiesto → ×1,95 misurato; massimo ≈ ×4,7.
- DS (melonDS): massimo ≈ ×1,1–1,3 in questo ambiente, limitato dalla CPU del server.

**Su iPad: non ho numeri.** ❓ Un iPad recente ha un processore molto più veloce di questo server, quindi
è plausibile un margine maggiore, ma va misurato col pulsante apposito: il rapporto diagnostico registra la
velocità minuto per minuto proprio per avere dati veri. Se il margine è poco, per il DS c'è DeSmuME 2015
con salto fotogrammi.

## 4. Rilevare un blocco e recuperare senza sovrascrivere uno stato buono

Due sorveglianti (`js/session.js`):
1. **Motore fermo**: il contatore dei fotogrammi non avanza per 8 s mentre il gioco è visibile e non in
   pausa, oppure errore WebAssembly, `abort` del core o perdita del contesto grafico ✅.
2. **Gioco piantato con emulatore attivo**: ogni 5 s Vesuvio prende il fotogramma del core; se resta
   **identico per 60 s mentre premi almeno 4 tasti**, è un blocco ✅. Il test lo dimostra con la ROM che,
   premendo SELECT, entra in un ciclo infinito su schermo nero: i fotogrammi continuano ad avanzare, quindi
   un controllo basato solo sul contatore (come quello descritto per Unova Pocket) non lo vedrebbe.

Quando scatta: stop ai salvataggi automatici; **stop a ogni cancellazione automatica** (gli stati vecchi non
possono essere eliminati per far posto); gli stati automatici creati poco prima vengono marcati
«sospetti» e «Continua» non li propone ✅; una copia dello stato bloccato viene conservata a parte
(«Diagnostica», per analisi, mai usata per «Continua»). Il banner propone: torna allo stato sano più recente
(con miniatura), scegli uno stato, esporta `.sav`, «il gioco funziona» (falso allarme) o ricarica ✅.

Limite onesto: un'immagine ferma con tasti premuti per 60 s può capitare anche senza blocco (raro);
in quel caso basta «Il gioco funziona». La soglia è regolabile o disattivabile.

## 5. C-Gear, Wi-Fi e ruota panoramica di Pokémon Bianco

Cosa c'è in Vesuvio:
- riconoscimento di Nero/Bianco/Nero 2/Bianco 2 dal codice gioco ✅ e consiglio al primo avvio e nel menu:
  rispondere «No» al C-Gear o spegnerlo dal pulsante sul C-Gear (la procedura che, secondo le segnalazioni,
  ha funzionato) 🔧;
- se un blocco avviene, la protezione del §4 evita di perdere gli stati precedenti 🔧 (verificato con la ROM
  di test, non con Pokémon);
- motori alternativi (DeSmuME) per provare la stessa scena con un'altra implementazione 🔧. Gli stati non
  passano da un motore all'altro; il `.sav` viene passato solo tra motori con lo stesso formato.

Cosa **non** c'è: nessuna riparazione automatica degli stati. La modifica di un byte descritta per Unova
Pocket richiede di sapere esattamente quale variabile si corregge; senza stati reali da analizzare non la
replico alla cieca. ❓ Il Wi-Fi del DS non può collegarsi a niente in un emulatore web; è plausibile che il
C-Gear, cercando continuamente connessioni, interagisca male con alcuni stati salvati, ma non è dimostrato.
Non ho riprodotto la ruota panoramica.

## 6. Test per dimostrare la stabilità

Già presenti (✅, tutti ripetibili con `npm test`, `npm run test:e2e`, `npm run test:soak`):
- per ogni core DS: avvio, tasti, X/Y, touch con coordinate controllate *dentro* la memoria del gioco,
  salvataggio e ripristino dello stato (anche in pausa) con verifica del contatore del gioco;
- l'app completa: riconoscimento ROM, riscaldamento, autosalvataggi solo con comandi, miniature, croce
  scorrevole, multi-touch, touch sul canvas ingrandito e in vista «solo touch», ripristino con copia di
  sicurezza, blocco morbido e duro, ritorno allo stato sano, «Continua» dopo ricarica, backup `.zip`;
- GBA: layout orizzontale, versioni del `.sav`, turbo reale, funzionamento offline;
- test di durata: sessione continua con turbo al massimo, input e autosalvataggi ogni 10 s; misura
  velocità, memoria JS, numero di stati e spazio nel tempo. Risultato di 30 minuti:
  [soak-melonds-30min.json](soak-melonds-30min.json) e riepilogo sotto.

Da fare con una ROM reale (richiede che tu o il tuo amico lo eseguiate con la vostra copia):
1. **Sessione lunga sull'iPad** con «Diagnostica» → esporta rapporto: velocità minuto per minuto e durata dei
   salvataggi. Se la velocità cala nel tempo, si vede quando e di quanto.
2. **Catena di stati**: dal salvataggio a Sciroccopoli, caricare stato → giocare la scena della ruota →
   salvare → ricaricare, ripetuto con C-Gear acceso e spento, su melonDS e DeSmuME.
3. **Determinismo**: stesso stato + stessa sequenza di tasti registrata → stesso fotogramma dopo N secondi;
   se diverge, il problema è nello stato o nel core, non nel giocatore.
4. **Matrice dispositivi**: iPad (Safari, app installata), iPhone, Android Chrome, PC.
5. **Compatibilità all'aggiornamento**: prima di aggiornare i core, ricaricare una raccolta di stati reali.

Nessuno di questi test, da solo, garantisce che l'intera campagna funzioni: lo riducono a casi misurabili.

## 7. Miglioramenti consigliati a Unova Pocket (per impatto, poi difficoltà)

1. **Riscaldamento + «niente comandi, niente autosalvataggio»** — impatto altissimo, facile. Elimina gli stati
   catturati durante l'avvio (il caso dei 4 fotogrammi) e impedisce che l'attesa faccia scorrere via quelli buoni.
2. **Miniature negli stati** — alto, facile. Si sceglie lo stato giusto a colpo d'occhio, e chi aiuta a
   distanza chiede «quello con la ruota sullo schermo».
3. **Versioni del `.sav`** invece di una sola copia — alto, facile.
4. **Sospendere le cancellazioni automatiche durante un blocco** e marcare gli stati recenti come sospetti
   — alto, facile.
5. **Touch assoluto e correzione per alta densità** — alto se il touch «sbaglia punto» su iPhone/iPad, facile
   da verificare: lo stesso frontend ha il difetto in EmulatorJS.
6. **Rilevare l'immagine ferma con tasti premuti** — medio-alto, medio.
7. **Rapporto diagnostico esportabile** (velocità per minuto, durata salvataggi) — medio-alto, facile: trasforma
   «rallenta dopo un po'» in un dato.
8. **Accesso cloud senza cookie di terze parti** (token nello storage dell'app, rinnovo silenzioso; oppure un
   «codice di sincronizzazione» senza scadenza) — alto per il problema del 401, medio-difficile.
9. **Motore alternativo selezionabile** (DeSmuME) per isolare i problemi del core — medio, medio.

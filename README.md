# RPG/RPGLE Block Folding

Estensione VS Code che fornisce il folding dei blocchi di controllo per file RPG fixed-format e RPGLE:

- IF / ELSEIF / ELSE / ENDIF (ELSEIF e ELSE sono gestiti come segmento dello stesso folding dell'IF)
- DO / DOW / DOU / ENDDO
- FOR / ENDFOR
- Subroutine: BEGSR / ENDSR (una subroutine non può contenerne altre; il folding va da BEGSR al primo ENDSR successivo)

Funziona per i linguaggi `rpg` e `rpgle` e utilizza le freccette native di VS Code per comprimere/espandere i blocchi.

## Installazione e build

1. Apri questa cartella in VS Code.
2. Installa le dipendenze:

```powershell
npm install
```

3. Compila TypeScript:

```powershell
npm run compile
```

4. Debug: premi F5 (o esegui la configurazione "Run Extension"). Si aprirà una nuova finestra di VS Code con l'estensione attiva in modalità sviluppo.

## Come funziona

L'estensione registra un `FoldingRangeProvider` per i linguaggi `rpg` e `rpgle`. Il provider:

- Riconosce l'inizio dei blocchi (IF/DO/DOW/DOU/FOR) e le relative terminazioni (ENDIF/ENDDO/ENDFOR).
- Traccia i rami `ELSEIF` e `ELSE` come segmenti del blocco `IF`, producendo folding separati per ciascuna sezione.
- Tenta di gestire sia fixed-format (colonne) sia, se abilitato, un semplice fallback per il free-form.

Impostazioni disponibili:

- `rpgFolding.enableFreeFormFallback` (boolean, default `true`): abilita un riconoscimento semplice anche per il free-form.

## Esempio

File di esempio in `samples/`:

```
     F****************************************************************
      * Esempio IF / ELSEIF / ELSE / ENDIF
      C                   IF        Cond1
      C                   ELSEIF    Cond2
      C                   ELSE
      C                   ENDIF

      C                   DO        i = 1 to 10
      C                   ENDDO

      C                   FOR       j = 1 to 5
      C                   ENDFOR

      C                   BEGSR     MiaSr
      C                   ENDSR
```

Apri uno dei file di esempio, vedrai le freccette di folding a sinistra.

## Note

- Il parser è intenzionalmente leggero e basato su pattern: potrebbe non coprire tutte le varianti o peculiarità del linguaggio. In caso di falsi positivi/negativi, apri una issue con un esempio minimo.
- L'estensione non definisce un grammar o colorazione per `rpg`/`rpgle`. Si appoggia alle definizioni di linguaggio già fornite dal tuo ambiente. Assicurati di avere un'estensione che riconosca questi linguaggi o definisci tu stesso un `files.associations`.

## Licenza

MIT

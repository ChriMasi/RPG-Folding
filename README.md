
# RPG/RPGLE Block Folding

[See the English version below](#english-version)


## Funzionalità principali

Questa estensione per VS Code è pensata per sorgenti RPG/RPGLE in formato fixed. Permette:

- **Folding dei blocchi logici**:
      - IF / ENDIF
      - DO / DOW / DOU / ENDDO
      - FOR / ENDFOR
      - SELECT / ENDSL
      - Subroutine: BEGSR / ENDSR (una subroutine non può contenerne altre; il folding va da BEGSR al primo ENDSR successivo)
- **Evidenziazione delle keyword correlate**:
      - Se selezioni una riga con IF, ELSE, ENDIF, tutte le linee correlate (IF, ENDIF, tutte le ELSE/ELSEIF/Xnn del blocco) vengono evidenziate
- **Colorazione della sintassi**:
      - Parole chiave di blocco (IF, DO, SELECT, BEGSR, ecc.) evidenziate in giallo senape
      - ELSE/ELSEIF/Xnn evidenziate in arancione
      - CALL e CALLP evidenziate in viola.
      Il colore è personalizzabile tramite impostazioni
- **Pin/unpin**: puoi "pinnare" un blocco per mantenere l'evidenziazione anche cambiando selezione

**Nota**: L'estensione è pensata per RPG/RPGLE fixed-format. L'uso su sorgenti free-format non è raccomandato: il parser è basato su pattern e non garantisce risultati affidabili su codice free.

Supporta i linguaggi `rpg` e `rpgle` e utilizza le freccette native di VS Code per comprimere/espandere i blocchi.




## Impostazioni disponibili

- `rpgFolding.enableFreeFormFallback` (boolean, default `true`): abilita un riconoscimento semplice anche per il free-form (sconsigliato).
- `rpgFolding.highlight.blockKeywordColor`: colore per le keyword di blocco (default giallo senape).
- `rpgFolding.highlight.elseColor`: colore per ELSE/ELSEIF/Xnn (default arancione).
- `rpgFolding.highlight.matchLineColor`: colore di sfondo per le righe di inizio/fine blocco evidenziate.
- `rpgFolding.highlight.matchElseLineColor`: colore di sfondo per le righe ELSE evidenziate.
- `rpgFolding.highlight.callColor`: colore per la keyword CALL/CALLP (default viola). Solo la parola chiave viene colorata, non la riga intera.


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
       C                   CALL      NomeProg
       C                   CALLP     NomeProc
```

Il folding è disponibile su IF/ENDIF, DO/ENDDO, FOR/ENDFOR, SELECT/ENDSL, BEGSR/ENDSR. Se selezioni una riga IF, ELSE o ENDIF, tutte le linee correlate vengono evidenziate.

## Note

- Il parser è intenzionalmente leggero e basato su pattern: potrebbe non coprire tutte le varianti o peculiarità del linguaggio. In caso di falsi positivi/negativi, apri una issue con un esempio minimo.
- L'estensione non definisce un grammar o colorazione per `rpg`/`rpgle`. Si appoggia alle definizioni di linguaggio già fornite dal tuo ambiente. Assicurati di avere un'estensione che riconosca questi linguaggi o definisci tu stesso un `files.associations`.

## Licenza

MIT

---


# English version

## Features

This VS Code extension is designed for RPG/RPGLE sources in fixed-format. It provides:

- **Folding of logic blocks**:
      - IF / ENDIF
      - DO / DOW / DOU / ENDDO
      - FOR / ENDFOR
      - SELECT / ENDSL
      - Subroutine: BEGSR / ENDSR (a subroutine cannot contain others; folding goes from BEGSR to the next ENDSR)
- **Highlighting of related keywords**:
      - When you select a line with IF, ELSE, or ENDIF, all related lines (IF, ENDIF, all ELSE/ELSEIF/Xnn in the block) are highlighted
- **Syntax highlighting**:
      - Block keywords (IF, DO, SELECT, BEGSR, etc.) highlighted in mustard yellow
      - ELSE/ELSEIF/Xnn highlighted in orange
      - CALL and CALLP highlighted in purple.
      The color is customizable via settings
- **Pin/unpin**: you can pin a block to keep it highlighted even when changing selection

**Note**: The extension is intended for RPG/RPGLE fixed-format. Usage on free-format sources is not recommended: the parser is pattern-based and does not guarantee reliable results on free-format code.

Supports the `rpg` and `rpgle` languages and uses VS Code's native folding arrows to collapse/expand blocks.


## Available settings

- `rpgFolding.enableFreeFormFallback` (boolean, default `true`): enables simple recognition for free-form (not recommended).
- `rpgFolding.highlight.blockKeywordColor`: color for block keywords (default mustard yellow).
- `rpgFolding.highlight.elseColor`: color for ELSE/ELSEIF/Xnn (default orange).
- `rpgFolding.highlight.matchLineColor`: background color for highlighted start/end block lines.
- `rpgFolding.highlight.matchElseLineColor`: background color for highlighted ELSE lines.
- `rpgFolding.highlight.callColor`: color for the CALL/CALLP keyword (default purple). Only the keyword is colored, not the whole line.


## Example

Sample file in `samples/`:

```
     F****************************************************************
      * Example IF / ELSEIF / ELSE / ENDIF
      C                   IF        Cond1
      C                   ELSEIF    Cond2
      C                   ELSE
      C                   ENDIF

      C                   DO        i = 1 to 10
      C                   ENDDO

      C                   FOR       j = 1 to 5
      C                   ENDFOR

      C                   BEGSR     MySr
      C                   ENDSR
      C                   CALL      ProgramName
      C                   CALLP     ProcName
```

Folding is available for IF/ENDIF, DO/ENDDO, FOR/ENDFOR, SELECT/ENDSL, BEGSR/ENDSR. When you select a line with IF, ELSE, or ENDIF, all related lines are highlighted.

## Notes

- The parser is intentionally lightweight and pattern-based: it may not cover all language variants or peculiarities. If you find false positives/negatives, open an issue with a minimal example.
- The extension does not define a grammar or coloring for `rpg`/`rpgle`. It relies on language definitions already provided by your environment. Make sure you have an extension that recognizes these languages or define your own `files.associations`.
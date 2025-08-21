import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  const selector: vscode.DocumentSelector = [
    { language: 'rpg' },
    { language: 'rpgle' }
  ];

  const provider = new RpgFoldingProvider();
  context.subscriptions.push(
    vscode.languages.registerFoldingRangeProvider(selector, provider)
  );
}

export function deactivate() {}

class RpgFoldingProvider implements vscode.FoldingRangeProvider {
  provideFoldingRanges(
    document: vscode.TextDocument,
    context: vscode.FoldingContext,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.FoldingRange[]> {
    const ranges: vscode.FoldingRange[] = [];

    // Stack per i blocchi con inizio riga
    interface Block { type: string; start: number; elseBranches: number[]; }
    const stack: Block[] = [];

    // Regex per fixed-format e (opzionale) free-form
    const cfg = vscode.workspace.getConfiguration('rpgFolding');
    const enableFreeForm = cfg.get<boolean>('enableFreeFormFallback', true);

    // Nelle sorgenti RPG fixed-format, le parole chiave di controllo spesso stanno nelle colonne 7-8+.
    // Gestiamo sia fixed-format (keyword a inizio riga ignorando numeri/commenti) che free-form semplificato.

    const patterns = buildPatterns(enableFreeForm);

    for (let i = 0; i < document.lineCount; i++) {
      const lineTextRaw = document.lineAt(i).text;
      const lineText = stripCommentsAndSequence(lineTextRaw);
      const low = lineText.trim().toLowerCase();

      // Match start of blocks
      if (patterns.if.test(low)) {
        stack.push({ type: 'if', start: i, elseBranches: [] });
        continue;
      }
      // ANDxx / ORxx sono continuazioni della condizione IF corrente: non aprono nuovi blocchi
      if (/\b(?:and|or)(?:eq|ne|gt|ge|lt|le)\b/.test(low)) {
        // nulla: fanno parte dell'IF più recente
      }
      if (patterns.do.test(low) || patterns.dow.test(low) || patterns.dou.test(low)) {
        stack.push({ type: 'do', start: i, elseBranches: [] });
        continue;
      }
      if (patterns.for.test(low)) {
        stack.push({ type: 'for', start: i, elseBranches: [] });
        continue;
      }
      if (patterns.select && patterns.select.test(low)) {
        stack.push({ type: 'select', start: i, elseBranches: [] });
        continue;
      }
      if (patterns.begsr && patterns.begsr.test(low)) {
        stack.push({ type: 'sr', start: i, elseBranches: [] });
        continue;
      }

  // ElseIf / Else belong to most recent IF
  if (patterns.elseif.test(low) || patterns.else.test(low) || /\bx\d{2}\b/.test(low)) {
        for (let s = stack.length - 1; s >= 0; s--) {
          if (stack[s].type === 'if') {
            stack[s].elseBranches.push(i);
            break;
          }
        }
        continue;
      }

      // Enders
      if (patterns.endif.test(low)) {
        closeTop('if', i, true);
        continue;
      }
      if (patterns.enddo.test(low)) {
        closeTop('do', i, false);
        continue;
      }
      if (patterns.endfor.test(low)) {
        closeTop('for', i, false);
        continue;
      }
      if (patterns.endsl && patterns.endsl.test(low)) {
        closeTop('select', i, false);
        continue;
      }
  if (patterns.endsr && patterns.endsr.test(low)) {
        closeTop('sr', i, false);
        continue;
      }
    }

    function closeTop(expected: string, endLine: number, includeElse: boolean) {
      for (let s = stack.length - 1; s >= 0; s--) {
        const blk = stack[s];
        if (blk.type === expected) {
          stack.splice(s, 1);
          // Crea un folding dal blocco iniziale fino alla riga precedente a END*
          if (endLine > blk.start) {
            // Fornisci un solo folding per l'intero blocco IF...ENDIF (includendo ELSEIF/ELSE)
            // e per DO/DOW/DOU/ENDDO e FOR/ENDFOR
            ranges.push(new vscode.FoldingRange(blk.start, endLine - 1));
          }
          return;
        }
      }
    }

    return ranges;
  }
}

// Rimuove numerazione colonne e commenti semplici
function stripCommentsAndSequence(line: string): string {
  // RPG fixed-format: spesso 1-5 numero sequenza, 6 indicatore; 7 inizia il contenuto.
  // Heuristics:
  // - Se i primi 6 sono spazi/numeri/* -> taglia 6
  // - Oppure se alla colonna 6 (index 5) c'è una lettera di specifica (C, D, F, etc) o '*' (commento) -> taglia 6
  let body = line;
  if (line.length >= 6) {
    const prefix = line.substring(0, 6);
    const specChar = line[5];
    if (/^[ 0-9*]{6}$/.test(prefix) || /[a-zA-Z*]/.test(specChar)) {
      body = line.substring(6);
    }
  }
  // Se dopo il taglio la colonna 7 (ora in posizione 0) è '*' -> riga di commento
  const leadTrim = body.replace(/^\s+/, '');
  if (leadTrim.startsWith('*')) {
    return '';
  }
  // Rimuove commenti stile // (per free-form o sorgenti moderni)
  const noDblSlash = body.split('//')[0];
  return noDblSlash;
}

function buildPatterns(enableFreeForm: boolean) {
  // Pattern combinati: supportano sia fixed-format (IFxx/ANxx/ORxx, CASEQ/ENDCS)
  // che free-form (if/endif, select/endsl) senza dover scegliere.
  return {
    // IF o IFEQ/IFNE/IFGT/IFGE/IFLT/IFLE
    if: /\bif(?:eq|ne|gt|ge|lt|le)?\b/,
    elseif: /\belseif\b/,
    else: /\belse\b/,
    endif: /\bendif\b/,
    do: /\bdo\b/,
    dow: /\bdow\b/,
    dou: /\bdou\b/,
    enddo: /\benddo\b/,
    for: /\bfor\b/,
    endfor: /\bendfor\b/,
    begsr: /\bbegsr\b/,
    endsr: /\bendsr\b/,
    // SELECT o CASE* (CASEQ/CASNE/..). Fold come blocco unico fino a ENDSL/ENDCS
    select: /(?:\bselect\b|\bcase(?:eq|ne|gt|ge|lt|le)?\b)/,
    endsl: /\bendsl\b/,
    endcs: /\bendcs\b/
  };
}

import * as vscode from 'vscode';

interface PinnedBlock { start: number; end: number; elseLines: number[] }

const KEYWORD_COLUMN_INDEX = 25; // column 26 in 1-based indexing

function getColumn26Setting(): boolean {
  const cfg = vscode.workspace.getConfiguration('rpgFolding');
  return cfg.get<boolean>('highlight.onlyColumn26', true);
}

export function activate(context: vscode.ExtensionContext) {
  const selector: vscode.DocumentSelector = [
    { language: 'rpg' },
    { language: 'rpgle' }
  ];

  const provider = new RpgFoldingProvider();
  context.subscriptions.push(
    vscode.languages.registerFoldingRangeProvider(selector, provider)
  );

  // Highlighting manager
  const highlighter = new RpgHighlighter();
  highlighter.setExtensionContext(context);
  context.subscriptions.push(highlighter);

  // register pin/unpin commands
  context.subscriptions.push(vscode.commands.registerCommand('rpgFolding.pinBlockHighlight', async () => {
    await highlighter.pinCurrentBlock();
  }));
  context.subscriptions.push(vscode.commands.registerCommand('rpgFolding.unpinBlockHighlight', async () => {
    await highlighter.unpinCurrentBlock();
  }));
  // toggle command for simpler context menu (pin/unpin)
  context.subscriptions.push(vscode.commands.registerCommand('rpgFolding.togglePinBlockHighlight', async () => {
    await highlighter.togglePinCurrentBlock();
  }));
}

export function deactivate() { }

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

class RpgHighlighter implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private blockDecoration?: vscode.TextEditorDecorationType;
  private elseDecoration?: vscode.TextEditorDecorationType;
  private matchDecoration?: vscode.TextEditorDecorationType;
  private matchDecorationElse?: vscode.TextEditorDecorationType;
  private pinnedDecoration?: vscode.TextEditorDecorationType;
  private pinnedElseDecoration?: vscode.TextEditorDecorationType;
  private callDecoration?: vscode.TextEditorDecorationType;
  private contextKey = 'rpgFolding.showPin';
  private contextUnpinKey = 'rpgFolding.showUnpin';
  private pinnedKey = 'rpgFolding.pinned';
  private context: vscode.ExtensionContext | undefined;


  constructor() {
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration(() => this.updateDecorations(true)),
      vscode.window.onDidChangeActiveTextEditor(() => this.updateDecorations(false)),
      vscode.window.onDidChangeVisibleTextEditors(() => this.applyPinnedHighlights()),
      vscode.window.onDidChangeWindowState(() => this.applyPinnedHighlights()),
      vscode.workspace.onDidChangeTextDocument(e => this.onDocumentChange(e)),
      vscode.workspace.onDidOpenTextDocument(() => this.updateDecorations(false)),
      vscode.window.onDidChangeTextEditorSelection(e => this.onSelectionChange(e))
    );

    this.updateDecorationTypes();
    // initial run
    this.updateDecorations(false);
  }

  public setExtensionContext(ctx: vscode.ExtensionContext) {
    this.context = ctx;
  }

  dispose() {
    this.disposables.forEach(d => d.dispose());
    this.blockDecoration?.dispose();
    this.elseDecoration?.dispose();
    this.matchDecoration?.dispose();
    this.matchDecorationElse?.dispose();
    this.pinnedDecoration?.dispose();
    this.pinnedElseDecoration?.dispose();
  }

  private updateDecorationTypes() {
    const cfg = vscode.workspace.getConfiguration('rpgFolding.highlight');
    const blockColor = cfg.get<string>('blockKeywordColor', '#C79C00');
    const elseColor = cfg.get<string>('elseColor', '#FFB74D');
    const matchLineColor = cfg.get<string>('matchLineColor', '#89CFF0');
    const matchElseLineColor = cfg.get<string>('matchElseLineColor', '#FFB74D');
    const callColor = cfg.get<string>('callColor', '#A259E6'); // viola default

    // Dispose old
    this.blockDecoration?.dispose();
    this.elseDecoration?.dispose();
    this.matchDecoration?.dispose();
    this.callDecoration?.dispose();

    // Decorazione per la parola-chiave del blocco: solo foreground (giallo senape)
    this.blockDecoration = vscode.window.createTextEditorDecorationType({
      color: blockColor,
      fontWeight: '600'
    });

    // Decorazione per la parola ELSE: solo foreground (light orange)
    this.elseDecoration = vscode.window.createTextEditorDecorationType({
      color: elseColor,
      fontWeight: '600'
    });

    // Decorazione per CALL/CALLP: solo foreground viola
    this.callDecoration = vscode.window.createTextEditorDecorationType({
      color: callColor,
      fontWeight: '600'
    });

    // Match decoration: highlight full line with translucent background + overview ruler
    this.matchDecoration = vscode.window.createTextEditorDecorationType({
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      isWholeLine: true,
      backgroundColor: matchLineColor + '33',
      overviewRulerColor: matchLineColor
    });

    this.matchDecorationElse?.dispose();
    this.matchDecorationElse = vscode.window.createTextEditorDecorationType({
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      isWholeLine: true,
      backgroundColor: matchElseLineColor + '22',
      overviewRulerColor: matchElseLineColor
    });

    this.pinnedDecoration?.dispose();
    this.pinnedDecoration = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: matchLineColor + '55',
      overviewRulerColor: matchLineColor
    });
    this.pinnedElseDecoration?.dispose();
    this.pinnedElseDecoration = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: matchElseLineColor + '44',
      overviewRulerColor: matchElseLineColor
    });
  }

  private onDocumentChange(e: vscode.TextDocumentChangeEvent) {
    // update if the changed document is visible
    const editors = vscode.window.visibleTextEditors.filter(ed => ed.document === e.document);
    if (editors.length) {
      this.updateDecorations(false);
    }
  }

  private onSelectionChange(e: vscode.TextEditorSelectionChangeEvent) {
    // update only matching highlights for the active editor
    this.updateMatchingForEditor(e.textEditor);
    this.updateContextForEditor(e.textEditor);
  }

  private updateDecorations(forceTypesUpdate: boolean) {
    if (!vscode.window.activeTextEditor) {
      // still apply pinned highlights to visible editors even if no active editor
      this.applyPinnedHighlights();
      return;
    }
    const cfgAll = vscode.workspace.getConfiguration('rpgFolding');
    const enable = cfgAll.get<boolean>('highlight.enable', true);
    if (!enable) {
      // clear
      vscode.window.visibleTextEditors.forEach(ed => {
        ed.setDecorations(this.blockDecoration!, []);
        ed.setDecorations(this.elseDecoration!, []);
        ed.setDecorations(this.matchDecoration!, []);
      });
      return;
    }

    if (forceTypesUpdate) this.updateDecorationTypes();

    // Apply to all visible editors
    vscode.window.visibleTextEditors.forEach(editor => this.decorateEditor(editor));
    // also apply pinned highlights
    this.applyPinnedHighlights();
  }

  private decorateEditor(editor: vscode.TextEditor) {
    const doc = editor.document;
    if (!doc) return;
    if (!/\b(rpg|rpgle)\b/i.test(doc.languageId)) return;

    const text = doc.getText();
    const lines = text.split(/\r?\n/);

    const patterns = buildPatterns(true);

  const blockRanges: vscode.Range[] = [];
  const elseRanges: vscode.Range[] = [];
  const callRanges: vscode.Range[] = [];

  interface Block { type: string; start: number; colorable: boolean; }
    const stack: Block[] = [];

    const onlyCol26 = getColumn26Setting();
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const lineText = stripCommentsAndSequence(raw).trim().toLowerCase();
      if (!lineText) continue;

      // Evidenzia CALL/CALLP (solo parola chiave, non blocco)
      const callMatch = findKeywordRange(raw, /\bcallp?\b/i, onlyCol26 ? KEYWORD_COLUMN_INDEX : undefined);
      if (callMatch) callRanges.push(new vscode.Range(i, callMatch.start.character, i, callMatch.end.character));

      if (patterns.if.test(lineText)) {
        const kwRange = findKeywordRange(raw, /\bif(?:eq|ne|gt|ge|lt|le)?\b/i, onlyCol26 ? KEYWORD_COLUMN_INDEX : undefined);
        const colorable = !!kwRange;
        stack.push({ type: 'if', start: i, colorable });
        if (kwRange) blockRanges.push(new vscode.Range(i, kwRange.start.character, i, kwRange.end.character));
        continue;
      }
      if (patterns.do.test(lineText) || patterns.dow.test(lineText) || patterns.dou.test(lineText)) {
        const kwRange = findKeywordRange(raw, /\bdo\b|\bdow\b|\bdou\b/i, onlyCol26 ? KEYWORD_COLUMN_INDEX : undefined);
        const colorable = !!kwRange;
        stack.push({ type: 'do', start: i, colorable });
        if (kwRange) blockRanges.push(new vscode.Range(i, kwRange.start.character, i, kwRange.end.character));
        continue;
      }
      if (patterns.for.test(lineText)) {
        const kwRange = findKeywordRange(raw, /\bfor\b/i, onlyCol26 ? KEYWORD_COLUMN_INDEX : undefined);
        const colorable = !!kwRange;
        stack.push({ type: 'for', start: i, colorable });
        if (kwRange) blockRanges.push(new vscode.Range(i, kwRange.start.character, i, kwRange.end.character));
        continue;
      }
      if (patterns.select && patterns.select.test(lineText)) {
        const kwRange = findKeywordRange(raw, /\bselect\b|\bcase(?:eq|ne|gt|ge|lt|le)?\b/i, onlyCol26 ? KEYWORD_COLUMN_INDEX : undefined);
        const colorable = !!kwRange;
        stack.push({ type: 'select', start: i, colorable });
        if (kwRange) blockRanges.push(new vscode.Range(i, kwRange.start.character, i, kwRange.end.character));
        continue;
      }
      if (patterns.begsr && patterns.begsr.test(lineText)) {
        const kwRange = findKeywordRange(raw, /\bBEGSR\b/i, onlyCol26 ? KEYWORD_COLUMN_INDEX : undefined);
        const colorable = !!kwRange;
        stack.push({ type: 'sr', start: i, colorable });
        if (kwRange) blockRanges.push(new vscode.Range(i, kwRange.start.character, i, kwRange.end.character));
        continue;
      }

      if (patterns.elseif.test(lineText) || patterns.else.test(lineText) || /\bx\d{2}\b/.test(lineText)) {
        const kwRange = findKeywordRange(raw, /\belseif\b|\belse\b|\bx\d{2}\b/i, onlyCol26 ? KEYWORD_COLUMN_INDEX : undefined);
        if (kwRange) {
          for (let s = stack.length - 1; s >= 0; s--) {
            if (stack[s].type === 'if') {
              if (stack[s].colorable) {
                elseRanges.push(new vscode.Range(i, kwRange.start.character, i, kwRange.end.character));
              }
              break;
            }
          }
        }
        continue;
      }

      if (patterns.endif.test(lineText)) {
        const kwRange = findKeywordRange(raw, /\bendif\b/i, onlyCol26 ? KEYWORD_COLUMN_INDEX : undefined);
        if (kwRange) blockRanges.push(new vscode.Range(i, kwRange.start.character, i, kwRange.end.character));
        for (let s = stack.length - 1; s >= 0; s--) {
          if (stack[s].type === 'if') { stack.splice(s, 1); break; }
        }
        continue;
      }
      if (patterns.enddo.test(lineText)) {
        const kwRange = findKeywordRange(raw, /\benddo\b/i, onlyCol26 ? KEYWORD_COLUMN_INDEX : undefined);
        if (kwRange) blockRanges.push(new vscode.Range(i, kwRange.start.character, i, kwRange.end.character));
        for (let s = stack.length - 1; s >= 0; s--) {
          if (stack[s].type === 'do') { stack.splice(s, 1); break; }
        }
        continue;
      }
      if (patterns.endfor.test(lineText)) {
        const kwRange = findKeywordRange(raw, /\bendfor\b/i, onlyCol26 ? KEYWORD_COLUMN_INDEX : undefined);
        if (kwRange) blockRanges.push(new vscode.Range(i, kwRange.start.character, i, kwRange.end.character));
        for (let s = stack.length - 1; s >= 0; s--) {
          if (stack[s].type === 'for') { stack.splice(s, 1); break; }
        }
        continue;
      }
      if (patterns.endsl && patterns.endsl.test(lineText)) {
        const kwRange = findKeywordRange(raw, /\bendsl\b|\bendcs\b/i, onlyCol26 ? KEYWORD_COLUMN_INDEX : undefined);
        if (kwRange) blockRanges.push(new vscode.Range(i, kwRange.start.character, i, kwRange.end.character));
        for (let s = stack.length - 1; s >= 0; s--) {
          if (stack[s].type === 'select') { stack.splice(s, 1); break; }
        }
        continue;
      }
      if (patterns.endsr && patterns.endsr.test(lineText)) {
        const kwRange = findKeywordRange(raw, /\bendsr\b/i, onlyCol26 ? KEYWORD_COLUMN_INDEX : undefined);
        if (kwRange) blockRanges.push(new vscode.Range(i, kwRange.start.character, i, kwRange.end.character));
        for (let s = stack.length - 1; s >= 0; s--) {
          if (stack[s].type === 'sr') { stack.splice(s, 1); break; }
        }
        continue;
      }
    }

    // Apply decorations (keywords foreground only)
    try {
      editor.setDecorations(this.blockDecoration!, blockRanges);
      editor.setDecorations(this.elseDecoration!, elseRanges);
      editor.setDecorations(this.callDecoration!, callRanges);
      this.updateMatchingForEditor(editor);
      this.updateContextForEditor(editor);
    } catch (e) {
      // ignore if disposed
    }
  }

  private updateContextForEditor(editor?: vscode.TextEditor) {
    if (!this.context) return;
    if (!editor) { vscode.commands.executeCommand('setContext', this.contextKey, false); vscode.commands.executeCommand('setContext', this.contextUnpinKey, false); return; }
    const doc = editor.document;
    if (!doc) return;
    const low = stripCommentsAndSequence(doc.lineAt(editor.selection.active.line).text).trim().toLowerCase();
    const patterns = buildPatterns(true);
    const isBlock = patterns.if.test(low) || patterns.do.test(low) || patterns.for.test(low) || (patterns.select && patterns.select.test(low)) || (patterns.begsr && patterns.begsr.test(low)) || patterns.else.test(low) || patterns.elseif.test(low) || patterns.endif.test(low) || (patterns.endsl && patterns.endsl.test(low)) || (patterns.endsr && patterns.endsr.test(low)) || (patterns.enddo && patterns.enddo.test(low)) || (patterns.endfor && patterns.endfor.test(low));
    const pinned = this.getPinnedForDocument(doc.uri.toString()) || [];
    const isPinned = isBlock && pinned.some(pb => editor.selection.active.line >= pb.start && editor.selection.active.line <= pb.end);
    // showPin: solo se su blocco logico e NON pinnato
    // showUnpin: solo se su blocco logico e pinnato
    vscode.commands.executeCommand('setContext', this.contextKey, isBlock && !isPinned);
    vscode.commands.executeCommand('setContext', this.contextUnpinKey, isBlock && isPinned);
  }

  private getPinnedForDocument(key: string): PinnedBlock[] | undefined {
    if (!this.context) return undefined;
    const rawMap = this.context.workspaceState.get<{ [uri: string]: any }>(this.pinnedKey, {});
    const val = rawMap[key];
    if (!val) return undefined;
    // Legacy format: array of numbers => convert to blocks (start=end=line)
    if (Array.isArray(val) && val.length && typeof val[0] === 'number') {
      return (val as number[]).map(n => ({ start: n, end: n, elseLines: [] }));
    }
    if (Array.isArray(val)) {
      // ensure shape: {start,end,elseLines}
      return (val as any[]).map(item => {
        if (typeof item === 'number') return { start: item, end: item, elseLines: [] } as PinnedBlock;
        return {
          start: typeof item.start === 'number' ? item.start : 0,
          end: typeof item.end === 'number' ? item.end : (typeof item.start === 'number' ? item.start : 0),
          elseLines: Array.isArray(item.elseLines) ? item.elseLines : []
        } as PinnedBlock;
      });
    }
    return undefined;
  }

  private async setPinnedForDocument(key: string, blocks: PinnedBlock[] | undefined) {
    if (!this.context) return;
    const map = this.context.workspaceState.get<{ [uri: string]: PinnedBlock[] }>(this.pinnedKey, {});
    if (blocks && blocks.length) map[key] = blocks; else delete map[key];
    await this.context.workspaceState.update(this.pinnedKey, map);
  }

  private applyPinnedHighlights() {
    if (!this.context) return;
    const map = this.context.workspaceState.get<{ [uri: string]: PinnedBlock[] }>(this.pinnedKey, {});
    vscode.window.visibleTextEditors.forEach(editor => {
      const key = editor.document.uri.toString();
      const blocks = map[key] || [];
      if (!blocks.length) {
        editor.setDecorations(this.pinnedDecoration!, []);
        editor.setDecorations(this.pinnedElseDecoration!, []);
        return;
      }
      const startEndRanges: vscode.Range[] = [];
      const elseRanges: vscode.Range[] = [];
      for (const b of blocks) {
        if (typeof b.start === 'number' && typeof b.end === 'number' && b.start <= b.end) {
          if (this.isValidLine(editor, b.start)) startEndRanges.push(new vscode.Range(b.start, 0, b.start, editor.document.lineAt(b.start).text.length));
          if (this.isValidLine(editor, b.end)) startEndRanges.push(new vscode.Range(b.end, 0, b.end, editor.document.lineAt(b.end).text.length));
        }
        if (Array.isArray(b.elseLines)) {
          for (const ln of b.elseLines) {
            if (this.isValidLine(editor, ln)) elseRanges.push(new vscode.Range(ln, 0, ln, editor.document.lineAt(ln).text.length));
          }
        }
      }
      editor.setDecorations(this.pinnedDecoration!, startEndRanges);
      editor.setDecorations(this.pinnedElseDecoration!, elseRanges);
    });
  }

  private isValidLine(editor: vscode.TextEditor, line: number) {
    if (!editor || !editor.document) return false;
    return Number.isInteger(line) && line >= 0 && line < editor.document.lineCount;
  }

  public async pinCurrentBlock() {
    const ed = vscode.window.activeTextEditor;
    if (!ed || !this.context) return;
    const doc = ed.document;
    const selLine = ed.selection.active.line;
    const key = doc.uri.toString();
    const block = this.findEnclosingBlock(doc, selLine);
    if (!block) return;
    const blocks = this.getPinnedForDocument(key) || [];
    // avoid duplicates (same start and end)
    if (!blocks.find(b => b.start === block.start && b.end === block.end)) {
      blocks.push(block);
      await this.setPinnedForDocument(key, blocks);
      this.applyPinnedHighlights();
      this.updateContextForEditor(vscode.window.activeTextEditor);
    }
  }

  public async unpinCurrentBlock() {
    const ed = vscode.window.activeTextEditor;
    if (!ed || !this.context) return;
    const doc = ed.document;
    const selLine = ed.selection.active.line;
    const key = doc.uri.toString();
    const blocks = this.getPinnedForDocument(key) || [];
    const idx = blocks.findIndex(b => selLine >= b.start && selLine <= b.end);
    if (idx !== -1) {
      blocks.splice(idx, 1);
      await this.setPinnedForDocument(key, blocks.length ? blocks : undefined);
      this.applyPinnedHighlights();
    }
  }

  public async togglePinCurrentBlock() {
    const ed = vscode.window.activeTextEditor;
    if (!ed || !this.context) return;
    const doc = ed.document;
    const selLine = ed.selection.active.line;
    const key = doc.uri.toString();
    const blocks = this.getPinnedForDocument(key) || [];
    // find if we are inside an existing pinned block
    const idx = blocks.findIndex(b => selLine >= b.start && selLine <= b.end);
    if (idx !== -1) {
      // unpin
      blocks.splice(idx, 1);
      await this.setPinnedForDocument(key, blocks.length ? blocks : undefined);
      this.applyPinnedHighlights();
      this.updateContextForEditor(vscode.window.activeTextEditor);
      return;
    }
    // otherwise pin
    const block = this.findEnclosingBlock(doc, selLine);
    if (!block) return;
    if (!blocks.find(b => b.start === block.start && b.end === block.end)) {
      blocks.push(block);
      await this.setPinnedForDocument(key, blocks);
      this.applyPinnedHighlights();
    }
  }

  private findEnclosingBlock(doc: vscode.TextDocument, lineIdx: number): PinnedBlock | undefined {
    const total = doc.lineCount;
    const patterns = buildPatterns(true);
    // normalize line
    const lineTextRaw = doc.lineAt(lineIdx).text;
    const low = stripCommentsAndSequence(lineTextRaw).trim().toLowerCase();
    if (!low) return undefined;

    // For IF blocks
    if (patterns.if.test(low) || patterns.else.test(low) || patterns.elseif.test(low) || patterns.endif.test(low) || /\bx\d{2}\b/.test(low)) {
      // find start: search backward for IF
      let start = -1;
      for (let i = lineIdx; i >= 0; i--) {
        const lt = stripCommentsAndSequence(doc.lineAt(i).text).trim().toLowerCase();
        if (!lt) continue;
        if (patterns.if.test(lt)) { start = i; break; }
      }
      if (start === -1) return undefined;
      // find end: search forward from start
      let depth = 0;
      let end = -1;
      const elseLines: number[] = [];
      for (let i = start + 1; i < total; i++) {
        const lt = stripCommentsAndSequence(doc.lineAt(i).text).trim().toLowerCase();
        if (!lt) continue;
        if (patterns.if.test(lt)) { depth++; continue; }
        if (patterns.else.test(lt) || patterns.elseif.test(lt) || /\bx\d{2}\b/.test(lt)) {
          if (depth === 0) elseLines.push(i);
          continue;
        }
        if (patterns.endif.test(lt)) {
          if (depth === 0) { end = i; break; } else { depth--; continue; }
        }
      }
      if (end === -1) return undefined;
      return { start, end, elseLines } as PinnedBlock;
    }

    // For DO/FOR/SELECT/SR blocks: find start and end if cursor on their keywords
    const startCandidates = ['do', 'dow', 'dou', 'for', 'select', 'begsr'];
    const endCandidates = ['enddo', 'endfor', 'endsl', 'endsr', 'endcs'];
    // search backward for nearest start
    let start = -1;
    for (let i = lineIdx; i >= 0; i--) {
      const lt = stripCommentsAndSequence(doc.lineAt(i).text).trim().toLowerCase();
      if (!lt) continue;
      if (patterns.do.test(lt) || patterns.dow.test(lt) || patterns.dou.test(lt) || patterns.for.test(lt) || (patterns.select && patterns.select.test(lt)) || (patterns.begsr && patterns.begsr.test(lt))) { start = i; break; }
    }
    if (start === -1) return undefined;
    // find corresponding end forward
    let depth = 0; let end = -1;
    for (let i = start + 1; i < total; i++) {
      const lt = stripCommentsAndSequence(doc.lineAt(i).text).trim().toLowerCase();
      if (!lt) continue;
      if (patterns.do.test(lt) || patterns.dow.test(lt) || patterns.dou.test(lt) || patterns.for.test(lt) || (patterns.select && patterns.select.test(lt)) || (patterns.begsr && patterns.begsr.test(lt))) { depth++; continue; }
      if (patterns.enddo.test(lt) || patterns.endfor.test(lt) || (patterns.endsl && patterns.endsl.test(lt)) || (patterns.endsr && patterns.endsr.test(lt)) || (patterns.endcs && patterns.endcs.test(lt))) {
        if (depth === 0) { end = i; break; } else { depth--; continue; }
      }
    }
    if (end === -1) return undefined;
    return { start, end, elseLines: [] } as PinnedBlock;
  }

  private updateMatchingForEditor(editor: vscode.TextEditor) {
    if (!editor) return;
    const doc = editor.document;
    const sel = editor.selection.active;
    const rawLine = doc.lineAt(sel.line).text;
    const low = stripCommentsAndSequence(rawLine).trim().toLowerCase();
    const patterns = buildPatterns(true);

  const onlyCol26 = getColumn26Setting();
  const ifKeyword = !!findKeywordRange(rawLine, /\bif(?:eq|ne|gt|ge|lt|le)?\b/i, onlyCol26 ? KEYWORD_COLUMN_INDEX : undefined);
  const doKeyword = !!findKeywordRange(rawLine, /\bdo\b|\bdow\b|\bdou\b/i, onlyCol26 ? KEYWORD_COLUMN_INDEX : undefined);
  const forKeyword = !!findKeywordRange(rawLine, /\bfor\b/i, onlyCol26 ? KEYWORD_COLUMN_INDEX : undefined);
  const selectKeyword = !!findKeywordRange(rawLine, /\bselect\b|\bcase(?:eq|ne|gt|ge|lt|le)?\b/i, onlyCol26 ? KEYWORD_COLUMN_INDEX : undefined);
  const srKeyword = !!findKeywordRange(rawLine, /\bBEGSR\b/i, onlyCol26 ? KEYWORD_COLUMN_INDEX : undefined);
  const elseKeyword = !!findKeywordRange(rawLine, /\belseif\b|\belse\b|\bx\d{2}\b/i, onlyCol26 ? KEYWORD_COLUMN_INDEX : undefined);
  const endifKeyword = !!findKeywordRange(rawLine, /\bendif\b/i, onlyCol26 ? KEYWORD_COLUMN_INDEX : undefined);
  const enddoKeyword = !!findKeywordRange(rawLine, /\benddo\b/i, onlyCol26 ? KEYWORD_COLUMN_INDEX : undefined);
  const endforKeyword = !!findKeywordRange(rawLine, /\bendfor\b/i, onlyCol26 ? KEYWORD_COLUMN_INDEX : undefined);
  const endslKeyword = !!findKeywordRange(rawLine, /\bendsl\b|\bendcs\b/i, onlyCol26 ? KEYWORD_COLUMN_INDEX : undefined);
  const endsrKeyword = !!findKeywordRange(rawLine, /\bendsr\b/i, onlyCol26 ? KEYWORD_COLUMN_INDEX : undefined);

  // Only proceed if cursor on a block keyword (start or end or else)
  const isBlockKeyword = ifKeyword || doKeyword || forKeyword || selectKeyword || srKeyword || elseKeyword || endifKeyword || enddoKeyword || endforKeyword || endslKeyword || endsrKeyword;
    if (!isBlockKeyword) {
      // clear matches (both blue and else-match)
      editor.setDecorations(this.matchDecoration!, []);
      editor.setDecorations(this.matchDecorationElse!, []);
      return;
    }

    // Find matching line using the folding provider logic similar to above
    const total = doc.lineCount;

    // Simple algorithm: if on a start keyword, search forward for its corresponding end considering nesting; if on an end, search backward.
    // Normalize to detect type
    const lineText = low;
    let searchType: string | undefined;
    let forward = true;
    if (ifKeyword) { searchType = 'if'; forward = true; }
    else if (doKeyword) { searchType = 'do'; forward = true; }
    else if (forKeyword) { searchType = 'for'; forward = true; }
    else if (selectKeyword) { searchType = 'select'; forward = true; }
    else if (srKeyword) { searchType = 'sr'; forward = true; }
    else if (endifKeyword) { searchType = 'if'; forward = false; }
    else if (enddoKeyword) { searchType = 'do'; forward = false; }
    else if (endforKeyword) { searchType = 'for'; forward = false; }
    else if (endslKeyword) { searchType = 'select'; forward = false; }
    else if (endsrKeyword) { searchType = 'sr'; forward = false; }
    else if (elseKeyword) {
      // else: find enclosing if (search backwards)
      searchType = 'if'; forward = false;
    }

    const isElseSelected = elseKeyword;

    if (!searchType) return;

    const docLines = [];
    for (let i = 0; i < total; i++) docLines.push(doc.lineAt(i).text);

    if (forward) {
      let depth = 0;
      const elseLines: number[] = [];
      if (isElseSelected) elseLines.push(sel.line);
      for (let i = sel.line + 1; i < total; i++) {
        const lt = stripCommentsAndSequence(docLines[i]).trim().toLowerCase();
        if (!lt) continue;
        if (searchType === 'if' && patterns.if.test(lt)) depth++;
        if (searchType === 'do' && (patterns.do.test(lt) || patterns.dow.test(lt) || patterns.dou.test(lt))) depth++;
        if (searchType === 'for' && patterns.for.test(lt)) depth++;
        if (searchType === 'select' && patterns.select.test(lt)) depth++;
        if (searchType === 'sr' && patterns.begsr && patterns.begsr.test(lt)) depth++;

        // collect ELSE/ELSEIF only at depth 0 for IF
        if (searchType === 'if' && (patterns.else.test(lt) || patterns.elseif.test(lt) || /\bx\d{2}\b/.test(lt))) {
          if (depth === 0) elseLines.push(i);
        }

        // check enders
        if (searchType === 'if' && patterns.endif.test(lt)) {
          if (depth === 0) { this.applyMatch(editor, sel.line, i, elseLines, isElseSelected); return; } else depth--;
        }
        if (searchType === 'do' && patterns.enddo.test(lt)) { if (depth === 0) { this.applyMatch(editor, sel.line, i, undefined, false); return; } else depth--; }
        if (searchType === 'for' && patterns.endfor.test(lt)) { if (depth === 0) { this.applyMatch(editor, sel.line, i, undefined, false); return; } else depth--; }
        if (searchType === 'select' && patterns.endsl && patterns.endsl.test(lt)) { if (depth === 0) { this.applyMatch(editor, sel.line, i, undefined, false); return; } else depth--; }
        if (searchType === 'sr' && patterns.endsr && patterns.endsr.test(lt)) { if (depth === 0) { this.applyMatch(editor, sel.line, i, undefined, false); return; } else depth--; }
      }
    } else {
      // search backward for matching start
      let depth = 0;
      const elseLines: number[] = [];
      if (isElseSelected) elseLines.push(sel.line);
      for (let i = sel.line - 1; i >= 0; i--) {
        const lt = stripCommentsAndSequence(docLines[i]).trim().toLowerCase();
        if (!lt) continue;
        // detect enders that increase depth
        if (searchType === 'if' && patterns.endif.test(lt)) depth++;
        if (searchType === 'do' && patterns.enddo.test(lt)) depth++;
        if (searchType === 'for' && patterns.endfor.test(lt)) depth++;
        if (searchType === 'select' && patterns.endsl && patterns.endsl.test(lt)) depth++;
        if (searchType === 'sr' && patterns.endsr && patterns.endsr.test(lt)) depth++;

        // collect ELSE/ELSEIF only at depth 0 for IF while searching backward
        if (searchType === 'if' && (patterns.else.test(lt) || patterns.elseif.test(lt) || /\bx\d{2}\b/.test(lt))) {
          if (depth === 0) elseLines.push(i);
        }

        // check starts
        if (searchType === 'if' && patterns.if.test(lt)) {
          if (depth === 0) {
            if (isElseSelected) {
              // we found the start; now find the matching endif from here to include the block end
              let endDepth = 0;
              let endLine: number | undefined = undefined;
              for (let j = i + 1; j < total; j++) {
                const tj = stripCommentsAndSequence(docLines[j]).trim().toLowerCase();
                if (!tj) continue;
                if (patterns.if.test(tj)) endDepth++;
                if (patterns.endif.test(tj)) {
                  if (endDepth === 0) { endLine = j; break; } else endDepth--;
                }
              }
              if (typeof endLine === 'number') {
                this.applyMatch(editor, i, endLine, elseLines, true);
                return;
              }
              // fallback: highlight start and current else
              this.applyMatch(editor, sel.line, i, elseLines, true);
              return;
            }
            this.applyMatch(editor, sel.line, i, elseLines, false);
            return;
          } else depth--;
        }
        if (searchType === 'do' && (patterns.do.test(lt) || patterns.dow.test(lt) || patterns.dou.test(lt))) { if (depth === 0) { this.applyMatch(editor, sel.line, i, undefined, false); return; } else depth--; }
        if (searchType === 'for' && patterns.for.test(lt)) { if (depth === 0) { this.applyMatch(editor, sel.line, i, undefined, false); return; } else depth--; }
        if (searchType === 'select' && patterns.select.test(lt)) { if (depth === 0) { this.applyMatch(editor, sel.line, i, undefined, false); return; } else depth--; }
        if (searchType === 'sr' && patterns.begsr && patterns.begsr.test(lt)) { if (depth === 0) { this.applyMatch(editor, sel.line, i, undefined, false); return; } else depth--; }
      }
    }

    // no match found: clear
    editor.setDecorations(this.matchDecoration!, []);
  }

  private applyMatch(editor: vscode.TextEditor, aLine: number, bLine: number, elseLines?: number[], elseSelected: boolean = false) {
    // Defensive: ensure aLine and bLine are valid
    const ranges: vscode.Range[] = [];
    if (this.isValidLine(editor, aLine)) ranges.push(new vscode.Range(aLine, 0, aLine, editor.document.lineAt(aLine).text.length));
    if (this.isValidLine(editor, bLine)) ranges.push(new vscode.Range(bLine, 0, bLine, editor.document.lineAt(bLine).text.length));
    editor.setDecorations(this.matchDecoration!, ranges);

    // ELSE lines should be orange-only. When cursor is on ELSE, we still keep start/end blue and
    // only color the ELSE lines with the orange matchDecorationElse.
    if (elseLines && elseLines.length) {
      const elseRanges: vscode.Range[] = [];
      for (const ln of elseLines) {
        if (this.isValidLine(editor, ln)) elseRanges.push(new vscode.Range(ln, 0, ln, editor.document.lineAt(ln).text.length));
      }
      editor.setDecorations(this.matchDecorationElse!, elseRanges);
    } else {
      editor.setDecorations(this.matchDecorationElse!, []);
    }
  }
}

// Trova il range della prima occorrenza della regex nella linea grezza raw.
function findKeywordRange(raw: string, re: RegExp, requiredColumn?: number): vscode.Range | undefined {
  const match = re.exec(raw);
  if (!match) return undefined;
  if (typeof requiredColumn === 'number' && match.index !== requiredColumn) return undefined;
  const start = match.index;
  const end = start + match[0].length;
  return new vscode.Range(0, start, 0, end);
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
  // Se dopo il taglio la colonna 7 (ora in posizione 0) è '*' -> riga di commento SOLO se * è in colonna 7 (index 6 nella riga originale)
  // Quindi: se la riga originale ha almeno 7 caratteri e il carattere in posizione 6 è '*', è commento
  if (line.length >= 7 && line[6] === '*') {
    return '';
  }
  // Altrimenti, se dopo il taglio la colonna 7 (ora in posizione 0) è '*' ma NON era in colonna 7 originale, NON è commento
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
  begsr: /\bBEGSR\b/i,
    endsr: /\bendsr\b/,
    // SELECT o CASE* (CASEQ/CASNE/..). Fold come blocco unico fino a ENDSL/ENDCS
    select: /(?:\bselect\b|\bcase(?:eq|ne|gt|ge|lt|le)?\b)/,
    endsl: /\bendsl\b/,
    endcs: /\bendcs\b/
  };
}

import { isTouch } from '../core/renderer.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.el = {
      hud: $('hud'), chapter: $('chapter'), objective: $('objective'), prompt: $('prompt'), toast: $('toast'),
      dialog: $('dialog'), name: $('dlg-name'), text: $('dlg-text'), party: $('party'), card: $('card'), fade: $('fade'),
      ending: $('ending'), endingText: $('ending-text'), invite: $('invite'),
    };
    this.typing = null;
    this.lastObjective = '';
    this.lastPrompt = '';
    document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => { b.closest('.modal').hidden = true; }));
    $('btn-help').addEventListener('click', () => { $('help').hidden = false; });
    $('btn-invite').addEventListener('click', () => this.openInvite());
    $('inv-copy').addEventListener('click', async () => {
      const input = $('inv-link');
      input.select();
      try { await navigator.clipboard.writeText(input.value); } catch { document.execCommand('copy'); }
      $('inv-copy').textContent = '已复制';
      setTimeout(() => { $('inv-copy').textContent = '复制'; }, 1600);
    });
  }

  show() { this.el.hud.hidden = false; }

  setChapter(label, title) { this.el.chapter.textContent = `${label} · ${title}`; }

  card(label, title) {
    const c = this.el.card;
    c.hidden = true;
    c.querySelector('small').textContent = label;
    c.querySelector('h2').textContent = title;
    void c.offsetWidth;
    c.hidden = false;
    clearTimeout(this.cardTimer);
    this.cardTimer = setTimeout(() => { c.hidden = true; }, 4300);
  }

  objective(text) {
    if (text === this.lastObjective) return;
    const changed = text && this.lastObjective.split('（')[0] !== text.split('（')[0];
    this.lastObjective = text;
    this.el.objective.textContent = text;
    if (changed) {
      this.el.objective.classList.remove('flash');
      void this.el.objective.offsetWidth;
      this.el.objective.classList.add('flash');
    }
  }

  prompt(label) {
    const html = label ? (isTouch ? `点击「互动」 ${label}` : `<kbd>E</kbd>${label}`) : '';
    if (html === this.lastPrompt) return;
    this.lastPrompt = html;
    this.el.prompt.innerHTML = html;
    this.el.prompt.hidden = !html;
  }

  toast(msg) {
    const t = this.el.toast;
    t.hidden = true;
    t.textContent = msg;
    void t.offsetWidth;
    t.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { t.hidden = true; }, 2700);
  }

  dialog(name, text, narration) {
    const d = this.el.dialog;
    d.hidden = false;
    document.body.classList.add('dlg-open');
    d.classList.toggle('narration', narration);
    this.el.name.textContent = name || '';
    clearInterval(this.typing);
    let i = 0;
    this.el.text.textContent = '';
    this.fullText = text;
    this.typing = setInterval(() => {
      i += 1;
      this.el.text.textContent = text.slice(0, i);
      if (i >= text.length) { clearInterval(this.typing); this.typing = null; }
    }, 38);
  }

  get dialogOpen() { return !this.el.dialog.hidden; }

  // Returns true if it only finished the typewriter (so the caller should not advance yet).
  finishTyping() {
    if (!this.typing) return false;
    clearInterval(this.typing);
    this.typing = null;
    this.el.text.textContent = this.fullText;
    return true;
  }

  hideDialog() {
    clearInterval(this.typing);
    this.typing = null;
    this.el.dialog.hidden = true;
    document.body.classList.remove('dlg-open');
  }

  party(list) {
    const html = list.map((p) => `<span><i style="background:${p.color}"></i>${p.label}</span>`).join('');
    if (html !== this.lastParty) { this.el.party.innerHTML = html; this.lastParty = html; }
  }

  fade(on, white = false) {
    const f = this.el.fade;
    f.classList.toggle('white', white);
    f.style.opacity = on ? '1' : '0';
    return new Promise((r) => setTimeout(r, 1250));
  }

  ending(text) {
    this.el.endingText.innerHTML = text;
    this.el.ending.hidden = false;
  }

  hideEnding() { this.el.ending.hidden = true; }

  setInvite(link, myRole, otherRole, offline) {
    $('inv-link').value = offline ? '联机服务暂时无法连接，当前为单人模式' : link;
    $('inv-role').textContent = myRole;
    $('inv-other').textContent = otherRole;
    $('inv-ai').textContent = otherRole;
    $('inv-copy').disabled = offline;
  }

  openInvite() { this.el.invite.hidden = false; }
}

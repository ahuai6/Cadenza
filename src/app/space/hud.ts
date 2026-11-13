// The HUD over the cathedral: the places, search, the room's sign, the focus card, the reticle and its tip, the player
// card, and the settings button. Plain markup (the scene drives it by id); its words in the interface's language.
import { ts } from './i18n';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const room = (k: string, on = false) =>
  `<button id="go-${k}" aria-pressed="${on}">${esc(ts('room.' + k))}<small>${esc(ts('room.' + k + '.sub'))}</small></button>`;
const gear =
  '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';

export const hudHtml = () => `
<canvas id="world" aria-label="${esc(ts('canvas'))}"></canvas>
<div class="veil" id="veil"></div>
<div class="loading" id="loading">${esc(ts('loading'))}</div>
<div class="hud top">
  <div class="mark">Cadenza<small>${esc(ts('mark'))}</small></div>
  <nav class="places card" aria-label="${esc(ts('places'))}">${room('gallery', true)}${room('atrium')}${room('lists')}${room('listening')}${room('settings')}</nav>
  <div class="tools">
    <div class="search card">
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg>
      <input id="q" type="search" placeholder="${esc(ts('search'))}" aria-label="${esc(ts('search'))}" autocomplete="off">
      <kbd>/</kbd>
      <ul class="results card" id="results" hidden></ul>
    </div>
    <span class="winbtns card" id="win-btns"></span>
    <button class="cfg card" id="cfg" aria-label="${esc(ts('settings'))}" title="${esc(ts('settings'))} ( , )">${gear}</button>
  </div>
</div>
<div class="hud sign" id="sign" style="opacity:0"><i>The Gallery</i><b>${esc(ts('room.gallery'))} · ${esc(ts('room.gallery.sub'))}</b><u></u></div>
<div class="hud focus card" id="focus" hidden>
  <div class="eyebrow" id="f-eye"></div>
  <h2 id="f-title"></h2>
  <p id="f-meta"></p>
  <ol id="f-list" hidden></ol>
  <div class="row"><button class="btn solid" id="f-play">${esc(ts('play'))}</button><button class="btn" id="f-close">${esc(ts('keep'))}</button></div>
</div>
<div class="hud subs" id="subs" aria-live="polite"></div>
<div class="hud tip card" id="tip" hidden></div>
<div class="hud reticle" id="reticle" hidden></div>
<div class="hud player card" aria-label="${esc(ts('room.listening.sub'))}">
  <button class="btn solid" id="pp" aria-label="${esc(ts('play'))}">▶</button>
  <div class="t"><b id="p-title">${esc(ts('nothing'))}</b><span id="p-sub"></span><div class="bar" id="p-seek" role="slider" tabindex="0" aria-label="${esc(ts('seek'))}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i id="p-bar"></i></div></div>
  <button class="btn hp" id="hp" aria-pressed="true" title="${esc(ts('phones.onHelp'))}">${esc(ts('phones.on'))}</button>
  <span class="extras" id="p-extra"></span>
  <button class="btn mini" id="rest" title="${esc(ts('rest'))}" aria-label="${esc(ts('rest'))}"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M19.5 14.2A7.8 7.8 0 0 1 9.8 4.5 7.8 7.8 0 1 0 19.5 14.2z"/></svg></button>
  <button class="btn mini" id="mini" aria-pressed="false" title="${esc(ts('mini'))}" aria-label="${esc(ts('mini'))}"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"><rect x="4" y="5.5" width="16" height="13" rx="3"/><rect x="11.5" y="11" width="6.5" height="5" rx="1.4"/></svg></button>
</div>`;

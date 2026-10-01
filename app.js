"use strict";

// Bring Your Own Pollen: OAuth + PKCE in the browser, no backend, no proxy.
const CLIENT_ID = "pk_bMIshK8jHvlNJVvA";
const REDIRECT = location.origin + location.pathname;
const AUTH_URL = "https://enter.pollinations.ai/authorize";
const TOKEN_URL = "https://enter.pollinations.ai/api/oauth/token";
const API = "https://gen.pollinations.ai";

const TEXT_MODEL = "openai/gpt-5.4-nano";
const TTS_MODEL = "openai/tts-1";
const STT_MODEL = "openai/gpt-transcribe";
const VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"];

const b64u = (buf) => btoa(String.fromCharCode.apply(null, new Uint8Array(buf))).replace(/\+/g, "-").split("/").join("_").replace(/=+$/, "");
const randB = (n) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return b64u(a); };
const s256 = async (v) => b64u(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)));
const $ = (id) => document.getElementById(id);

let token = localStorage.getItem("stf_token") || "";
let login = localStorage.getItem("stf_login") || "";
let lastAudioUrl = null;

/* ---------- sign in ---------- */
async function signIn() {
  const verifier = randB(32);
  localStorage.setItem("pkce_v", verifier);
  const q = new URLSearchParams({
    response_type: "code", client_id: CLIENT_ID, redirect_uri: REDIRECT,
    scope: "profile usage", state: randB(16),
    code_challenge: await s256(verifier), code_challenge_method: "S256"
  });
  location.href = AUTH_URL + "?" + q.toString();
}

async function handleCallback() {
  const p = new URLSearchParams(location.search);
  const code = p.get("code");
  if (!code || token) return;
  const verifier = localStorage.getItem("pkce_v") || "";
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: CLIENT_ID, code_verifier: verifier }).toString()
  });
  const d = await r.json();
  if (d.access_token) {
    token = d.access_token;
    localStorage.setItem("stf_token", token);
    history.replaceState(null, "", location.pathname);
  }
  authUI();
}

function authUI() {
  const s = $("status");
  if (token) {
    s.textContent = "Signed in — the case, the answers and the voices are paid with your own Pollen.";
    $("signin").textContent = "Sign out";
  } else {
    s.textContent = "Sign in with Pollinations to open a case. Every line and every voice is your own Pollen.";
    $("signin").textContent = "Sign in with Pollinations";
  }
}


/* ---------- subjects: one real photograph, one matching machine drawing ---------- */
const IMAGE_MODEL = "flux";
const ROUND_MS = 12000;
const TOPICS = [
  { q: "hot air balloon festival", p: "a photograph of a hot air balloon festival at sunrise", t: "count the ropes: on the machine version they fray into the balloon fabric." },

  { q: "golden retriever puppy", p: "a photograph of a golden retriever puppy in a park", t: "look at the paws: the machine drawing usually adds a sixth toe." },
  { q: "sushi platter", p: "a photograph of a sushi platter on a wooden table", t: "follow the chopsticks, the machine version fuses them into one." },
  { q: "old wooden cabin in snow", p: "a photograph of an old wooden cabin in deep snow", t: "the window frame is never quite square on the machine side." },
  { q: "street food market at night", p: "a photograph of a night street food market with string lights", t: "read the signs: machine lettering melts into nonsense syllables." },
  { q: "mountain lake reflection", p: "a photograph of a mountain lake with a still reflection", t: "the machine reflection drifts a little off the real skyline." },
  { q: "honeybee on a sunflower", p: "a photograph of a honeybee on a sunflower", t: "wings are the giveaway: the machine bee gets four where two belong." },
  { q: "vintage motorcycle", p: "a photograph of a vintage motorcycle on a cobbled street", t: "the spokes stop making sense where they meet the hub." },
  { q: "coffee and an open book", p: "a photograph of a cup of coffee beside an open book", t: "steam curls in a pattern that never actually rises." },
  { q: "snow leopard on a rock", p: "a photograph of a snow leopard resting on a rock", t: "count the whiskers on each side, they never match." },
  { q: "blue door in a white wall", p: "a photograph of a blue wooden door in a whitewashed wall", t: "hinges and handle drift, and the lock sits off centre." },
  { q: "ferris wheel at night", p: "a photograph of a ferris wheel lit up at night", t: "follow the spokes to the centre: they never all meet at one point." },
  { q: "wooden fishing boats in a harbour", p: "a photograph of wooden fishing boats in a small harbour", t: "the rigging becomes a ladder to nowhere." },
  { q: "chess board mid game", p: "a photograph of a chess board in the middle of a game", t: "machine pieces lose their shape the further they sit from the middle." },
  { q: "old library reading room", p: "a photograph of an old library reading room with tall shelves", t: "the book spines on the top shelf turn into blank bricks." }
];

/* ---------- the real half: a public domain photograph from Commons ---------- */
async function realPhoto(query) {
  const api = "https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrlimit=12"
    + "&gsrsearch=" + encodeURIComponent("filetype:bitmap " + query)
    + "&prop=imageinfo&iiprop=url&iiurlwidth=512&format=json&origin=*";
  const j = await (await fetch(api)).json();
  const pages = Object.values((j.query && j.query.pages) || {});
  const ok = pages.filter(function (p) { return p.imageinfo && p.imageinfo[0] && p.imageinfo[0].thumburl; });
  if (!ok.length) throw new Error("no public domain photo for this subject");
  const pick = ok[Math.floor(Math.random() * ok.length)];
  return { url: pick.imageinfo[0].thumburl, title: pick.title };
}

/* ---------- the fake half: drawn fresh, paid for by the player ---------- */
async function fakePhoto(prompt) {
  const seed = Math.floor(Math.random() * 999999);
  const u = API + "/image/" + encodeURIComponent(prompt) + "?width=640&height=640&seed=" + seed + "&model=" + IMAGE_MODEL + "&nologo=true";
  const r = await fetch(u, { headers: { Authorization: "Bearer " + token } });
  if (!r.ok) throw new Error("image model " + r.status);
  return URL.createObjectURL(await r.blob());
}

/* ---------- round state ---------- */
const state = { score: 0, streak: 0, round: 0, fakeIsA: true, topic: null, busy: false, timer: null, deadline: 0 };

function tick() {
  const left = Math.max(0, state.deadline - Date.now());
  $("timerbar").style.width = (left / ROUND_MS * 100) + "%";
  if (left <= 0) { clearInterval(state.timer); state.timer = null; answer(null); }
}

function loaded(img) {
  return new Promise(function (res) {
    if (img.complete && img.naturalWidth) return res();
    img.onload = function () { res(); };
    img.onerror = function () { res(); };
  });
}

async function deal() {
  if (!token) { signIn(); return; }
  if (state.busy) return;
  state.busy = true;
  $("verdict").hidden = true;
  $("board").hidden = true;
  $("timerwrap").hidden = true;
  $("start").disabled = true;
  $("status").textContent = "Finding a photograph, then drawing a fake of the same thing...";
  const topic = TOPICS[Math.floor(Math.random() * TOPICS.length)];
  try {
    const both = await Promise.all([realPhoto(topic.q), fakePhoto(topic.p)]);
    const real = both[0], fake = both[1];
    state.topic = topic;
    state.fakeIsA = Math.random() < 0.5;
    $("imgA").src = state.fakeIsA ? fake : real.url;
    $("imgB").src = state.fakeIsA ? real.url : fake;
    $("vsrc").textContent = "The real photograph: " + real.title.replace("File:", "") + " (Wikimedia Commons, public domain).";
    await Promise.all([loaded($("imgA")), loaded($("imgB"))]);
  } catch (e) {
    $("status").textContent = "Round failed (" + e.message + "). Deal again.";
    state.busy = false;
    $("start").disabled = false;
    return;
  }
  state.round += 1;
  $("round").textContent = state.round;
  $("board").hidden = false;
  $("timerwrap").hidden = false;
  $("cardA").classList.remove("fake");
  $("cardB").classList.remove("fake");
  $("status").textContent = "Which one is the fake? " + (ROUND_MS / 1000) + " seconds.";
  state.deadline = Date.now() + ROUND_MS;
  state.timer = setInterval(tick, 80);
}

function answer(side) {
  if (!state.busy) return;
  state.busy = false;
  if (state.timer) { clearInterval(state.timer); state.timer = null; }
  $("timerwrap").hidden = true;
  const fakeSide = state.fakeIsA ? "A" : "B";
  const right = side === fakeSide;
  if (right) { state.score += 1; state.streak += 1; } else { state.streak = 0; }
  $("score").textContent = state.score;
  $("streak").textContent = state.streak;
  $("vhead").textContent = side === null ? "Time ran out. The fake was " + fakeSide + "." : (right ? "Caught it - " + fakeSide + " was the fake." : "Missed. " + fakeSide + " was the fake.");
  $("vtell").textContent = "What gives it away: " + state.topic.t;
  $("cardA").classList.toggle("fake", state.fakeIsA);
  $("cardB").classList.toggle("fake", !state.fakeIsA);
  $("verdict").hidden = false;
  $("status").textContent = "Score " + state.score + ", streak " + state.streak + ".";
  $("start").disabled = false;
}

/* ---------- wiring ---------- */
$("start").onclick = deal;
$("next").onclick = deal;
$("cardA").onclick = function () { answer("A"); };
$("cardB").onclick = function () { answer("B"); };
document.addEventListener("keydown", function (e) {
  if (!state.busy) return;
  if (e.key === "1" || e.key === "a" || e.key === "A") answer("A");
  if (e.key === "2" || e.key === "b" || e.key === "B") answer("B");
});
authUI();
handleCallback();

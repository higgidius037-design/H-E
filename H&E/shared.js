/* Shared H&E phone auth, paired chat, and demo wallet. Never put a service key here. */
(function () {
  "use strict";
  const SUPABASE_URL = "https://tqhvlazzvypbqrsjqmwz.supabase.co";
  const SUPABASE_PUBLIC_KEY = "sb_publishable_N9cMzyM6ULmYXZTxiu2zQw_opajzSu1";
  const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY, {
    auth: {
      persistSession: true, autoRefreshToken: true, detectSessionInUrl: true,
      experimental: { passkey: true }
    }
  });
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const bytesToB64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
  const b64ToBytes = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
  const normalEmail = value => {
    const email = String(value || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
    return email;
  };
  const idb = new Promise((resolve, reject) => {
    const request = indexedDB.open("he-private-keys-v1", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("keys");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  async function keyStore(mode, action) {
    const dbi = await idb;
    return new Promise((resolve, reject) => {
      const tx = dbi.transaction("keys", mode), store = tx.objectStore("keys");
      const result = action(store);
      tx.oncomplete = () => resolve(result?.result);
      tx.onerror = () => reject(tx.error);
    });
  }
  const getKeyPair = () => keyStore("readonly", s => s.get("pair"));
  const putKeyPair = pair => keyStore("readwrite", s => s.put(pair, "pair"));
  const originalRenderChats = renderChats;
  let session = null, coupleId = null, ownKeyPair = null, partner = null;
  let remoteChats = [], openedOnce = new Map(), channel = null, callChannel = null, peerConnection = null, localStream = null, pendingOffer = null, queuedIce = [], callKind = "voice";

  function addSetupUI() {
    const form = document.getElementById("loginForm");
    const email = document.getElementById("loginEmail"), password = document.getElementById("loginPassword");
    const toggleMethod = document.getElementById("toggleLoginMethod");
    const submitButton = document.getElementById("loginSubmit");
    const passkeyButton = document.getElementById("loginPasskey");
    let isSignUp = false;
    const note = form.querySelector(".login-note");
    const feedback = document.getElementById("loginFeedback");
    const reportLogin = (message, kind = "error") => { if (feedback) { feedback.textContent = message; feedback.dataset.kind = kind; feedback.hidden = false; } };
    const friendlyAuthError = error => {
      const code = String(error?.code || "").toLowerCase(); const message = String(error?.message || "");
      if (code === "invalid_credentials") return "That email and password did not match. Check them and try again.";
      if (code === "email_not_confirmed") return "Confirm your email using the link we sent, then sign in again.";
      if (code === "user_banned") return "This account is temporarily unavailable. Contact the app owner for help.";
      if (code === "passkey_disabled") return "Passkey sign-in is not enabled for this account yet. Sign in with your password first.";
      if (code === "webauthn_credential_not_found") return "No passkey is enrolled for this account yet. Sign in with your email and password, then enable fingerprint unlock in Settings.";
      if (code === "webauthn_challenge_expired") return "That biometric request expired. Tap the fingerprint button again.";
      if (/failed to fetch|network|load failed/i.test(message)) return "Could not reach secure sign-in. Check your internet connection and retry.";
      if (error?.name === "NotAllowedError" || error?.name === "AbortError") return "The phone cancelled the biometric prompt. Tap again and approve it on your device.";
      return message || "Sign-in did not complete. Please try again.";
    };
    toggleMethod.addEventListener("click", () => {
      isSignUp = !isSignUp;
      if (feedback) feedback.hidden = true;
      document.getElementById("loginName").required = isSignUp;
      submitButton.textContent = isSignUp ? "Create account →" : "Log in →";
      toggleMethod.textContent = isSignUp ? "Already have an account? Log in" : "New here? Create an account";
      password.autocomplete = isSignUp ? "new-password" : "current-password";
      if (note) note.textContent = isSignUp
        ? "Create your account with an email and password. Check your email if confirmation is required."
        : "Sign in securely with your email and password. Phone verification is not required.";
    });
    passkeyButton.addEventListener("click", async () => {
      passkeyButton.disabled = true;
      reportLogin("Waiting for your phone to verify your passkey…", "wait");
      try {
        const { data, error } = await db.auth.signInWithPasskey();
        if (error) throw error;
        if (!data.session) throw new Error("Passkey sign-in did not return a session.");
        await enterApp(data.session);
      } catch (error) { const message = friendlyAuthError(error); reportLogin(message); toast(message, true); }
      finally { passkeyButton.disabled = false; }
    });
    form.addEventListener("submit", async event => {
      event.preventDefault(); event.stopImmediatePropagation();
      submitButton.disabled = true;
      submitButton.textContent = isSignUp ? "Creating account…" : "Signing in…";
      reportLogin(isSignUp ? "Creating your secure account…" : "Checking your sign-in…", "wait");
      try {
        const address = normalEmail(email.value);
        const displayName = document.getElementById("loginName").value.trim();
        if (isSignUp) {
          const { data, error } = await db.auth.signUp({
            email: address,
            password: password.value,
            options: { data: { display_name: displayName } }
          });
          if (error) throw error;
          if (data.session) {
            await enterApp(data.session);
          } else {
            if (note) note.textContent = "Account created. Check your email to confirm it, then return here to log in.";
            reportLogin("Account created. Confirm your email from the link we sent, then log in.", "ok");
            toast("Account created. Check your email to confirm it.");
            isSignUp = false;
            document.getElementById("loginName").required = false;
            submitButton.textContent = "Log in →";
            toggleMethod.textContent = "New here? Create an account";
          }
        } else {
          const { data, error } = await db.auth.signInWithPassword({ email: address, password: password.value });
          if (error) throw error;
          if (!data.session) throw new Error("Sign-in did not return a session. Check your email confirmation and try again.");
          await enterApp(data.session);
        }
      } catch (error) { const message = friendlyAuthError(error); reportLogin(message); toast(message, true); }
      finally { submitButton.disabled = false; submitButton.textContent = isSignUp ? "Create account →" : "Log in →"; }
    }, true);

    const settings = document.getElementById("page-settings");
    const card = document.createElement("div");
    card.className = "card"; card.id = "sharedSetupCard";
    card.innerHTML = `<h2 class="section-title">Connect our phones</h2>
      <p class="muted" id="sharedStatus">Sign in with your email to start a private shared space.</p>
      <label for="partnerEmail">Your partner's email</label>
      <input id="partnerEmail" type="email" inputmode="email" placeholder="partner@example.com">
      <button class="secondary" id="makePairInvite" type="button">Create pairing code</button>
      <p id="pairCodeText" class="muted" hidden></p>
      <label for="pairCode">Pairing code from your partner</label>
      <input id="pairCode" autocomplete="one-time-code" placeholder="Paste pairing code">
      <button class="secondary" id="acceptPairInvite" type="button">Join shared space</button>
      <p class="muted">Private chat uses encryption on this device. Compare the safety code with your partner using a call before sharing sensitive messages.</p>
      <p id="safetyCode" class="pill" hidden></p>
      <button class="secondary" id="registerPasskey" type="button">Enable fingerprint / face unlock on this device</button>
      <button class="secondary" id="sharedSignOut" type="button">Sign out</button>`;
    settings.prepend(card);
    document.getElementById("makePairInvite").addEventListener("click", createInvite);
    document.getElementById("acceptPairInvite").addEventListener("click", acceptInvite);
    document.getElementById("registerPasskey").addEventListener("click", async event => {
      const button = event.currentTarget; button.disabled = true;
      try {
        if (!session) throw new Error("Sign in with your email and password first, then enable biometrics here.");
        const { data, error } = await db.auth.registerPasskey();
        if (error) throw error;
        toast("Fingerprint / face unlock is ready on this device.");
        button.textContent = "Biometric passkey ready";
      } catch (error) { const message = friendlyAuthError(error); setStatus(message); toast(message, true); }
      finally { button.disabled = false; }
    });
    const signOut = async () => {
      if (!confirm("Log out of H&E on this device? You will need to enter your email and password again.")) return;
      const buttons = [document.getElementById("logoutButton"), document.getElementById("sharedSignOut")].filter(Boolean);
      buttons.forEach(button => { button.disabled = true; });
      try {
        const { error } = await db.auth.signOut({ scope: "local" });
        if (error) throw error;
        session = null;
        coupleId = null;
        partner = null;
        remoteChats = [];
        if (channel) { await db.removeChannel(channel); channel = null; }
        if (callChannel) { await db.removeChannel(callChannel); callChannel = null; }
        location.reload();
      } catch (error) {
        buttons.forEach(button => { button.disabled = false; });
        toast(error.message || "Could not log out. Please try again.", true);
      }
    };
    document.getElementById("sharedSignOut").addEventListener("click", signOut);
    document.getElementById("logoutButton")?.addEventListener("click", signOut);
    document.getElementById("chatForm").addEventListener("submit", sendMessage, true);
    document.getElementById("chatList").addEventListener("click", openViewOnce, true);
    document.getElementById("walletForm").addEventListener("submit", sharedWallet, true);
  }

  function setStatus(message) { document.getElementById("sharedStatus").textContent = message; }
  async function ensureKeys() {
    ownKeyPair = await getKeyPair();
    if (!ownKeyPair) {
      ownKeyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveKey"]);
      await putKeyPair(ownKeyPair);
    }
    const publicKey = bytesToB64(await crypto.subtle.exportKey("raw", ownKeyPair.publicKey));
    const { data: existingProfile } = await db.from("profiles").select("display_name").eq("user_id", session.user.id).maybeSingle();
    const { error } = await db.from("profiles").upsert({
      user_id: session.user.id, display_name: document.getElementById("loginName").value.trim() || state.profile.you || session.user.user_metadata?.display_name || existingProfile?.display_name || "H&E",
      encryption_public_key: publicKey, encryption_key_version: 1, updated_at: new Date().toISOString()
    });
    if (error) throw error;
  }
  async function enterApp(nextSession, showIntro = true) {
    const activeSession = nextSession || (await db.auth.getSession()).data.session;
    if (!activeSession || (session && session.user.id === activeSession.user.id && !document.getElementById("loginScreen"))) return;
    const previousSession = session; session = activeSession;
    try {
      const phone = session.user.phone || state.profile.phone || "";
      const name = document.getElementById("loginName")?.value.trim() || state.profile.you || session.user.user_metadata?.display_name || "H&E";
      state.profile = { ...state.profile, you: name, phone, email: session.user.email || state.profile.email || "" };
      saveState(); renderProfile(); await ensureKeys();
      const login = document.getElementById("loginScreen"); if (login) login.remove(); if (showIntro) startWelcome();
    } catch (error) { session = previousSession; throw error; }
    try { await refreshPairing(); } catch (error) { console.error("Pairing setup did not finish after sign-in", error); setStatus("You are signed in. Shared features could not connect yet; check your connection and try again in Settings."); toast("Signed in, but shared features could not connect. Check your connection.", true); }
  }
  async function refreshPairing() {
    const { data: members, error } = await db.from("couple_members").select("couple_id,user_id").eq("user_id", session.user.id).limit(1);
    if (error) throw error;
    if (!members?.length) { coupleId = null; setStatus("Your account is ready. Enter your partner's email to create a pairing code, or paste theirs to join."); return; }
    coupleId = members[0].couple_id;
    const { data: allMembers, error: memberError } = await db.from("couple_members").select("user_id").eq("couple_id", coupleId);
    if (memberError) throw memberError;
    const other = allMembers.find(row => row.user_id !== session.user.id);
    if (!other) { setStatus("Waiting for your partner to join."); return; }
    const { data: profile, error: profileError } = await db.from("profiles").select("display_name,encryption_public_key").eq("user_id", other.user_id).single();
    if (profileError) throw profileError;
    partner = { id: other.user_id, name: profile.display_name || "Your partner", publicKey: profile.encryption_public_key };
    if (!partner.publicKey) { setStatus("Your partner needs to sign in again to set up private messaging."); return; }
    await showSafetyCode();
    await refreshMessages();
    if (channel) db.removeChannel(channel);
    if (callChannel) db.removeChannel(callChannel);
    callChannel = db.channel("he-call-" + coupleId, { config: { private: true } }).on("broadcast", { event: "signal" }, ({ payload }) => handleCallSignal(payload)).subscribe();
    channel = db.channel("he-chat-" + coupleId)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: "couple_id=eq." + coupleId }, () => refreshMessages())
      .on("postgres_changes", { event: "*", schema: "public", table: "demo_wallet_transactions", filter: "couple_id=eq." + coupleId }, () => refreshWallet())
      .subscribe();
    await refreshWallet(); setStatus("Connected with " + partner.name + ". Shared encrypted chat and demo balance are ready.");
  }
  async function createInvite() {
    try {
      if (!session) throw new Error("Sign in first.");
      const email = normalEmail(document.getElementById("partnerEmail").value);
      const { data, error } = await db.rpc("create_pair_invite", { p_recipient: email });
      if (error) throw error;
      const target = document.getElementById("pairCodeText"); target.hidden = false;
      target.textContent = "Share this one-time code privately with " + email + ": " + data;
      document.getElementById("partnerEmail").value = email;
      toast("Pairing code created. It expires in 24 hours."); await refreshPairing();
    } catch (error) { toast(error.message || "Could not create a pairing code.", true); }
  }
  async function acceptInvite() {
    try {
      if (!session) throw new Error("Sign in first.");
      const code = document.getElementById("pairCode").value.trim();
      const { error } = await db.rpc("accept_pair_invite", { p_code: code });
      if (error) throw error;
      toast("Your shared space is connected."); await refreshPairing();
    } catch (error) { toast(error.message || "Could not join this shared space.", true); }
  }
  async function cryptoKey() {
    if (!partner?.publicKey) throw new Error("Your partner has not finished private key setup.");
    const remote = await crypto.subtle.importKey("raw", b64ToBytes(partner.publicKey), { name: "ECDH", namedCurve: "P-256" }, false, []);
    return crypto.subtle.deriveKey({ name: "ECDH", public: remote }, ownKeyPair.privateKey, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function encryptPayload(payload) {
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, await cryptoKey(), encoder.encode(JSON.stringify(payload)));
    return { ciphertext: bytesToB64(encrypted), nonce: bytesToB64(nonce) };
  }
  async function decryptPayload(row) {
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64ToBytes(row.nonce) }, await cryptoKey(), b64ToBytes(row.ciphertext));
    return JSON.parse(decoder.decode(decrypted));
  }
  async function refreshMessages() {
    if (!coupleId || !partner) return;
    const { data, error } = await db.from("messages").select("id,sender_id,recipient_id,ciphertext,nonce,message_type,view_once,opened_at,created_at").eq("couple_id", coupleId).order("created_at", { ascending: true }).limit(250);
    if (error) { toast("Could not load shared messages: " + error.message, true); return; }
    const chats = [];
    for (const row of data || []) {
      const mine = row.sender_id === session.user.id;
      if (row.view_once && row.opened_at && !mine) { chats.push({ id: row.id, mine, name: partner.name, date: new Date(row.created_at).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" }), viewOnce: true, opened: true, message: "", attachment:null, voice:null }); continue; }
      if (row.view_once && !mine) { chats.push({ id: row.id, mine, name: partner.name, date: new Date(row.created_at).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" }), viewOnce: true, opened: false, message: "", attachment:null, voice:null }); continue; }
      try {
        const payload = await decryptPayload(row);
        chats.push({ id: row.id, mine, name: mine ? state.profile.you : partner.name, date: new Date(row.created_at).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" }), createdAt: new Date(row.created_at).getTime(), viewOnce: row.view_once, opened: row.opened_at, ...payload });
      } catch (error) { console.warn("Could not decrypt message", row.id, error); }
    }
    remoteChats = chats; state.chats = chats; renderChats();
  }
  async function sendMessage(event) {
    event.preventDefault(); event.stopImmediatePropagation();
    try {
      if (!coupleId || !partner) throw new Error("Pair your phones first in Settings.");
      const message = document.getElementById("chatMessage").value.trim();
      const attachment = pendingChatFile;
      if (!message && !attachment) return;
      const once = document.getElementById("viewOnceToggle")?.checked || false;
      await sendEncrypted({ message, attachment: attachment || null, voice: null }, attachment?.type === "video" ? "video" : attachment ? "image" : "text", once);
      document.getElementById("chatMessage").value = ""; document.getElementById("chatAttachment").value = "";
      document.getElementById("chatPreviewContent").innerHTML = ""; document.getElementById("chatAttachmentPreview").classList.add("hidden");
      document.getElementById("viewOnceToggle").checked = false; pendingChatFile = null;
      await refreshMessages();
    } catch (error) { toast(error.message || "Message could not be sent.", true); }
  }
  async function sendEncrypted(payload, type = "text", once = false) {
    if (!coupleId || !partner) throw new Error("Pair your phones first in Settings.");
    const serialized = JSON.stringify(payload);
    if (serialized.length > 700000) throw new Error("This attachment is too large to share securely. Choose a smaller file.");
    const encrypted = await encryptPayload(payload);
    const { error } = await db.from("messages").insert({ couple_id: coupleId, sender_id: session.user.id, recipient_id: partner.id, ciphertext: encrypted.ciphertext, nonce: encrypted.nonce, message_type: type, view_once: once });
    if (error) throw error;
    await refreshMessages();
  }
  window.heSharedSend = async (payload, type = "voice", once = false) => {
    try { await sendEncrypted(payload, type, once); }
    catch (error) { toast(error.message || "Could not share this securely.", true); }
  };
  async function openViewOnce(event) {
    const button = event.target.closest("[data-open-once]"); if (!button) return;
    button.disabled = true;
    try {
      const { data, error } = await db.rpc("consume_view_once_message", { p_message_id: button.dataset.openOnce });
      if (error) throw error;
      const row = data?.[0]; if (!row?.ciphertext) throw new Error("This message is no longer available.");
      const payload = await decryptPayload(row);
      openedOnce.set(button.dataset.openOnce, payload);
      remoteChats = remoteChats.map(chat => chat.id === button.dataset.openOnce ? { ...chat, ...payload, opened: true } : chat);
      state.chats = remoteChats; renderChats(); await refreshMessages();
    } catch (error) { toast(error.message || "Could not open this item.", true); button.disabled = false; }
  }
  async function refreshWallet() {
    if (!coupleId) return;
    const { data, error } = await db.rpc("get_demo_balance", { p_couple_id: coupleId });
    if (error) throw error;
    const { data: rows, error: txError } = await db.from("demo_wallet_transactions").select("kind,amount,created_at").eq("couple_id", coupleId).order("created_at", { ascending: false }).limit(20);
    if (txError) throw txError;
    state.wallet.balance = Number(data || 0);
    state.wallet.transactions = (rows || []).reverse().map(row => ({ type: row.kind === "deposit" ? "deposit" : "withdraw", amount: Number(row.amount), date: new Date(row.created_at).toLocaleString() }));
    renderWallet(); saveState();
  }
  async function sharedWallet(event) {
    if (!session) return;
    event.preventDefault(); event.stopImmediatePropagation();
    try {
      if (!coupleId) throw new Error("Pair your phones first in Settings.");
      const action = document.getElementById("walletAction").value;
      const amount = Number(document.getElementById("walletAmount").value);
      const pin = document.getElementById("walletPin").value;
      if (!state.wallet.pin) throw new Error("Set a Wallet PIN in Settings first.");
      if (pin !== state.wallet.pin) throw new Error("Incorrect Wallet PIN.");
      const { data, error } = await db.rpc("record_demo_transaction", { p_couple_id: coupleId, p_kind: action === "withdraw" ? "withdrawal" : "deposit", p_amount: amount, p_idempotency_key: crypto.randomUUID() });
      if (error) throw error;
      state.wallet.balance = Number(data || 0); state.wallet.transactions = state.wallet.transactions || [];
      state.wallet.transactions.push({ type: action, amount, date: new Date().toLocaleString() });
      saveState(); renderWallet(); document.getElementById("walletActionCard").classList.add("hidden");
      toast("Shared demo balance updated. No real money moved.");
    } catch (error) { toast(error.message || "Wallet update failed.", true); }
  }
  async function showSafetyCode() {
    const localPublic = bytesToB64(await crypto.subtle.exportKey("raw", ownKeyPair.publicKey));
    const pair = [localPublic, partner.publicKey].sort().join(":");
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(pair)));
    const code = Array.from(digest.slice(0, 6), b => b.toString(16).padStart(2,"0").toUpperCase()).join(" ");
    const el = document.getElementById("safetyCode"); el.hidden = false; el.textContent = "Safety code: " + code;
  }
  window.renderChats = function () {
    if (!session) return originalRenderChats();
    const list = document.getElementById("chatList");
    if (!remoteChats.length) { list.innerHTML = `<div class="chat-date-divider">Your story starts here ♡</div><p class="muted" style="text-align:center">${coupleId ? "Send your first private message." : "Connect with your partner in Settings first."}</p>`; return; }
    list.innerHTML = remoteChats.map(chat => {
      const isMine = chat.mine !== false; let content = "";
      if (chat.viewOnce && !isMine && !chat.opened) content = `<button class="secondary" type="button" data-open-once="${chat.id}">Open once</button>`;
      else if (chat.viewOnce && !isMine && chat.opened && !openedOnce.has(chat.id)) content = `<p class="muted">Viewed once</p>`;
      else {
        const item = openedOnce.get(chat.id) || chat;
        if (item.message) content += `<p class="chat-text">${escapeHTML(item.message)}</p>`;
        if (item.attachment?.data) content += item.attachment.type === "video" ? `<video class="chat-media" controls playsinline src="${item.attachment.data}"></video>` : `<img class="chat-media" alt="Shared photo" src="${item.attachment.data}">`;
        if (item.voice) content += `<div class="voice-tile"><audio class="chat-audio" preload="metadata" src="${item.voice}"></audio><button class="voice-play" type="button" data-voice-play aria-label="Play voice note">▶</button></div>`;
        if (chat.viewOnce && openedOnce.has(chat.id)) content += `<button class="link-button" type="button" data-close-once="${chat.id}">Close view</button>`;
      }
      return `<article class="chat-bubble ${isMine ? "mine" : "theirs"}">${!isMine ? `<div class="chat-sender">${escapeHTML(chat.name || partner?.name || "Partner")}</div>` : ""}${content}<div class="chat-time"><span>${escapeHTML(chat.date || "")}</span>${isMine ? '<span class="chat-tick">✓</span>' : ""}</div></article>`;
    }).join("");
    list.querySelectorAll("[data-close-once]").forEach(btn => btn.addEventListener("click", () => { openedOnce.delete(btn.dataset.closeOnce); refreshMessages(); }));
    list.querySelectorAll("[data-voice-play]").forEach(btn=>btn.addEventListener("click",event=>{event.stopPropagation();const audio=btn.closest(".voice-tile").querySelector("audio");if(audio.paused){audio.play();btn.textContent="Ⅱ";}else{audio.pause();btn.textContent="▶";}audio.onended=()=>btn.textContent="▶";}));
    const bottom = document.getElementById("chatList"); bottom.scrollTop = bottom.scrollHeight;
  };
  async function callSignal(type, data = {}) { if (!callChannel || !partner) throw new Error("Pair your phones first in Settings."); const result = await callChannel.send({ type: "broadcast", event: "signal", payload: { from: session.user.id, to: partner.id, type, ...data } }); if (result !== "ok") throw new Error("Could not reach your paired phone."); }
  function showCall(incoming=false) { $("callOverlay").classList.add("open"); $("callTitle").textContent=(callKind==="video"?"Video":"Voice")+" call"; $("callStatus").textContent=incoming?partner.name+" is calling you":"Calling "+partner.name+"…"; $("incomingCallControls").style.display=incoming?"flex":"none"; $("activeCallControls").style.display=incoming?"none":"flex"; }
  async function getCallMedia(video) { if (!navigator.mediaDevices?.getUserMedia) throw new Error("Calls need a secure browser connection and microphone permission."); localStream=await navigator.mediaDevices.getUserMedia({audio:true,video:video?{facingMode:"user"}:false}); $("localCallVideo").srcObject=localStream; $("localCallVideo").style.display=video?"block":"none"; }
  function makePeer() { peerConnection=new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"}]}); peerConnection.onicecandidate=e=>{if(e.candidate)callSignal("ice",{candidate:e.candidate}).catch(err=>toast(err.message,true));}; peerConnection.ontrack=e=>{$("remoteCallVideo").srcObject=e.streams[0];}; peerConnection.onconnectionstatechange=()=>{if(peerConnection?.connectionState==="connected")$("callStatus").textContent="Connected securely with "+partner.name;if(["failed","disconnected"].includes(peerConnection?.connectionState))$("callStatus").textContent="Connection interrupted. Try again on another network.";}; localStream.getTracks().forEach(t=>peerConnection.addTrack(t,localStream)); }
  async function startCall(video) { try { if(!coupleId||!partner)throw new Error("Pair your phones first in Settings.");if(!callChannel)throw new Error("Private calling is not ready. Reload after the security update.");callKind=video?"video":"voice";await getCallMedia(video);makePeer();showCall();const offer=await peerConnection.createOffer();await peerConnection.setLocalDescription(offer);await callSignal("offer",{offer,callKind}); } catch(e) { stopCall();toast(e.message||"Could not start call.",true); } }
  async function handleCallSignal(m) { if(!m||m.to!==session?.user?.id||m.from!==partner?.id)return;try{if(m.type==="offer"){if(peerConnection)stopCall();pendingOffer=m.offer;callKind=m.callKind==="video"?"video":"voice";showCall(true);}else if(m.type==="answer"&&peerConnection){await peerConnection.setRemoteDescription(m.answer);for(const c of queuedIce.splice(0))await peerConnection.addIceCandidate(c);}else if(m.type==="ice"){if(peerConnection?.remoteDescription)await peerConnection.addIceCandidate(m.candidate);else queuedIce.push(m.candidate);}else if(["reject","hangup"].includes(m.type)){stopCall();toast(m.type==="reject"?"Call declined.":"Call ended.");}}catch(e){stopCall();toast("Could not connect this call.",true);} }
  async function acceptCall() { try { await getCallMedia(callKind==="video");makePeer();await peerConnection.setRemoteDescription(pendingOffer);pendingOffer=null;for(const c of queuedIce.splice(0))await peerConnection.addIceCandidate(c);const answer=await peerConnection.createAnswer();await peerConnection.setLocalDescription(answer);await callSignal("answer",{answer});showCall(false); }catch(e){stopCall();toast(e.message||"Could not accept call.",true);} }
  function stopCall() { if(peerConnection){peerConnection.onicecandidate=null;peerConnection.close();}peerConnection=null;if(localStream)localStream.getTracks().forEach(t=>t.stop());localStream=null;queuedIce=[];pendingOffer=null;$("localCallVideo").srcObject=null;$("remoteCallVideo").srcObject=null;$("callOverlay").classList.remove("open"); }
  $("startVoiceCall").addEventListener("click",()=>startCall(false));$("startVideoCall").addEventListener("click",()=>startCall(true));$("acceptCall").addEventListener("click",acceptCall);
  $("rejectCall").addEventListener("click",async()=>{await callSignal("reject").catch(()=>{});stopCall();});$("endCall").addEventListener("click",async()=>{await callSignal("hangup").catch(()=>{});stopCall();});
  $("muteCall").addEventListener("click",e=>{const t=localStream?.getAudioTracks()[0];if(t){t.enabled=!t.enabled;e.currentTarget.textContent=t.enabled?"Mute":"Unmute";}});$("cameraCall").addEventListener("click",e=>{const t=localStream?.getVideoTracks()[0];if(t){t.enabled=!t.enabled;e.currentTarget.textContent=t.enabled?"Turn camera off":"Turn camera on";}});
  async function boot() {
    addSetupUI();
    const loginScreen = document.getElementById("loginScreen");
    if (loginScreen) loginScreen.style.display = "none";
    const { data, error } = await db.auth.getSession();
    if (error) throw error;
    if (data.session) {
      await enterApp(data.session, false);
    } else if (loginScreen) {
      loginScreen.style.display = "grid";
    }
  }
  boot().catch(error => {
    console.error(error);
    const loginScreen = document.getElementById("loginScreen");
    if (loginScreen) loginScreen.style.display = "grid";
    const box = document.getElementById("loginFeedback");
    if (box) {
      box.textContent = "Secure sign-in could not start. Refresh the page and try again.";
      box.hidden = false;
    }
    toast("Shared app setup failed: " + (error.message || "unknown error"), true);
  });
})();

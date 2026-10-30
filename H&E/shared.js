/* Shared H&E phone auth, paired chat, and demo wallet. Never put a service key here. */
(function () {
  "use strict";
  const SUPABASE_URL = "https://tqhvlazzvypbqrsjqmwz.supabase.co";
  const SUPABASE_PUBLIC_KEY = "sb_publishable_N9cMzyM6ULmYXZTxiu2zQw_opajzSu1";
  const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const bytesToB64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
  const b64ToBytes = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
  const normalPhone = value => {
    const digits = String(value || "").replace(/[\s()-]/g, "");
    if (/^0[17]\d{8}$/.test(digits)) return "+254" + digits.slice(1);
    if (/^254[17]\d{8}$/.test(digits)) return "+" + digits;
    if (/^\+?[1-9]\d{7,14}$/.test(digits)) return digits[0] === "+" ? digits : "+" + digits;
    throw new Error("Enter the phone number with country code, such as +254712345678.");
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
  let remoteChats = [], openedOnce = new Map(), channel = null, pendingPhone = "";

  function addSetupUI() {
    const form = document.getElementById("loginForm");
    const email = document.getElementById("loginEmail"), password = document.getElementById("loginPassword");
    const emailFields = document.getElementById("emailLoginFields");
    const phone = document.getElementById("loginPhone");
    const phoneLabel = document.getElementById("loginPhoneLabel");
    const toggleMethod = document.getElementById("toggleLoginMethod");
    let loginMode = "phone";
    const note = form.querySelector(".login-note");
    if (note) note.textContent = "Phone sign-in sends a one-time verification code. Email sign-in works for an existing account with a verified phone number.";
    toggleMethod.addEventListener("click", () => {
      loginMode = loginMode === "phone" ? "email" : "phone";
      const useEmail = loginMode === "email";
      emailFields.hidden = !useEmail;
      email.required = useEmail;
      password.required = useEmail;
      phone.hidden = useEmail;
      phone.required = !useEmail;
      phoneLabel.hidden = useEmail;
      toggleMethod.textContent = useEmail ? "Use phone number instead" : "Use email and password instead";
      otp.hidden = true;
      otp.required = false;
      if (note) note.textContent = useEmail
        ? "Enter the email and password for your existing account."
        : "Enter your phone number to receive a one-time verification code.";
    });
    const otp = document.createElement("input");
    otp.id = "sharedOtp"; otp.inputMode = "numeric"; otp.autocomplete = "one-time-code";
    otp.placeholder = "6-digit SMS code"; otp.maxLength = 6; otp.hidden = true;
    otp.setAttribute("aria-label", "SMS verification code");
    form.insertBefore(otp, form.querySelector("button[type=submit]"));
    form.addEventListener("submit", async event => {
      event.preventDefault(); event.stopImmediatePropagation();
      const button = form.querySelector("button[type=submit]");
      button.disabled = true;
      try {
        if (loginMode === "email") {
          const { data, error } = await db.auth.signInWithPassword({ email: email.value.trim(), password: password.value });
          if (error) throw error;
          if (!data.session?.user?.phone) throw new Error("This account has no verified phone number yet. Use phone sign-in to continue.");
          await enterApp(data.session);
        } else if (!otp.hidden) {
          const { data, error } = await db.auth.verifyOtp({ phone: pendingPhone, token: otp.value.trim(), type: "sms" });
          if (error) throw error;
          await enterApp(data.session);
        } else {
          pendingPhone = normalPhone(document.getElementById("loginPhone").value);
          const { error } = await db.auth.signInWithOtp({ phone: pendingPhone });
          if (error) throw error;
          otp.hidden = false; otp.required = true;
          button.textContent = "Verify code →";
          note.textContent = "Enter the SMS code sent to " + pendingPhone + ".";
          otp.focus(); toast("Verification code sent.");
        }
      } catch (error) { toast(error.message || "Phone sign-in failed.", true); }
      finally { button.disabled = false; }
    }, true);

    const settings = document.getElementById("page-settings");
    const card = document.createElement("div");
    card.className = "card"; card.id = "sharedSetupCard";
    card.innerHTML = `<h2 class="section-title">Connect our phones</h2>
      <p class="muted" id="sharedStatus">Sign in with your phone to start a private shared space.</p>
      <label for="partnerPhone">Your partner's phone (international format)</label>
      <input id="partnerPhone" type="tel" inputmode="tel" placeholder="+254712345678">
      <button class="secondary" id="makePairInvite" type="button">Create pairing code</button>
      <p id="pairCodeText" class="muted" hidden></p>
      <label for="pairCode">Pairing code from your partner</label>
      <input id="pairCode" autocomplete="one-time-code" placeholder="Paste pairing code">
      <button class="secondary" id="acceptPairInvite" type="button">Join shared space</button>
      <p class="muted">Private chat uses encryption on this device. Compare the safety code with your partner using a call before sharing sensitive messages.</p>
      <p id="safetyCode" class="pill" hidden></p>
      <button class="secondary" id="sharedSignOut" type="button">Sign out</button>`;
    settings.prepend(card);
    document.getElementById("makePairInvite").addEventListener("click", createInvite);
    document.getElementById("acceptPairInvite").addEventListener("click", acceptInvite);
    document.getElementById("sharedSignOut").addEventListener("click", async () => {
      if (!confirm("Sign out of H&E on this phone?")) return;
      await db.auth.signOut(); location.reload();
    });
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
      user_id: session.user.id, display_name: document.getElementById("loginName").value.trim() || state.profile.you || existingProfile?.display_name || "H&E",
      encryption_public_key: publicKey, encryption_key_version: 1, updated_at: new Date().toISOString()
    });
    if (error) throw error;
  }
  async function enterApp(nextSession) {
    const activeSession = nextSession || (await db.auth.getSession()).data.session;
    if (!activeSession || (session && session.user.id === activeSession.user.id)) return;
    session = activeSession;
    const phone = session.user.phone || pendingPhone;
    const name = document.getElementById("loginName").value.trim() || state.profile.you || "H&E";
    state.profile = { ...state.profile, you: name, phone, email: "" };
    saveState(); renderProfile();
    await ensureKeys();
    document.getElementById("loginScreen").remove();
    startWelcome();
    await refreshPairing();
  }
  async function refreshPairing() {
    const { data: members, error } = await db.from("couple_members").select("couple_id,user_id").eq("user_id", session.user.id).limit(1);
    if (error) throw error;
    if (!members?.length) { coupleId = null; setStatus("Your account is verified. Enter your partner's number to create a pairing code, or paste theirs to join."); return; }
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
    channel = db.channel("he-chat-" + coupleId)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: "couple_id=eq." + coupleId }, () => refreshMessages())
      .on("postgres_changes", { event: "*", schema: "public", table: "demo_wallet_transactions", filter: "couple_id=eq." + coupleId }, () => refreshWallet())
      .subscribe();
    await refreshWallet(); setStatus("Connected with " + partner.name + ". Shared encrypted chat and demo balance are ready.");
  }
  async function createInvite() {
    try {
      if (!session) throw new Error("Sign in first.");
      const phone = normalPhone(document.getElementById("partnerPhone").value);
      const { data, error } = await db.rpc("create_pair_invite", { p_recipient_phone: phone });
      if (error) throw error;
      const target = document.getElementById("pairCodeText"); target.hidden = false;
      target.textContent = "Share this one-time code privately with " + phone + ": " + data;
      document.getElementById("partnerPhone").value = phone;
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
        if (item.voice) content += `<audio class="chat-audio" controls src="${item.voice}"></audio>`;
        if (chat.viewOnce && openedOnce.has(chat.id)) content += `<button class="link-button" type="button" data-close-once="${chat.id}">Close view</button>`;
      }
      return `<article class="chat-bubble ${isMine ? "mine" : "theirs"}">${!isMine ? `<div class="chat-sender">${escapeHTML(chat.name || partner?.name || "Partner")}</div>` : ""}${content}<div class="chat-time"><span>${escapeHTML(chat.date || "")}</span>${isMine ? '<span class="chat-tick">✓</span>' : ""}</div></article>`;
    }).join("");
    list.querySelectorAll("[data-close-once]").forEach(btn => btn.addEventListener("click", () => { openedOnce.delete(btn.dataset.closeOnce); refreshMessages(); }));
    const bottom = document.getElementById("chatList"); bottom.scrollTop = bottom.scrollHeight;
  };
  async function boot() {
    addSetupUI();
    const preview = document.getElementById("chatForm");
    const onceLabel = document.createElement("label"); onceLabel.className = "muted"; onceLabel.style.cssText = "display:flex;align-items:center;gap:8px;margin:8px 0";
    onceLabel.innerHTML = '<input id="viewOnceToggle" type="checkbox"> View once'; preview.insertAdjacentElement("beforebegin", onceLabel);
    const { data } = await db.auth.getSession();
    if (data.session) { session = data.session; await enterApp(session); }
    db.auth.onAuthStateChange((_event, newSession) => { if (newSession && !session) enterApp(newSession).catch(e => toast(e.message, true)); });
  }
  boot().catch(error => { console.error(error); toast("Shared app setup failed: " + (error.message || "unknown error"), true); });
})();

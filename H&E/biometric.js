/* H&E browser platform-authenticator support.
   This provides local device verification only; it is not server-verified account authentication. */
(function () {
  "use strict";
  const STORAGE_KEY = "he_webauthn_platform_credential_v1";
  const USER_KEY = "he_webauthn_user_id_v1";
  const b64url = bytes => {
    let binary = "";
    new Uint8Array(bytes).forEach(byte => binary += String.fromCharCode(byte));
    return btoa(binary).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/g, "");
  };
  const randomBytes = length => crypto.getRandomValues(new Uint8Array(length));
  const supported = () => !!(window.PublicKeyCredential && navigator.credentials && window.isSecureContext);

  async function registerOrVerify() {
    if (!supported()) {
      throw new Error("Your device doesn't support biometric sign-in in this browser. Use your account password instead.");
    }
    if (PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) {
      const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      if (!available) throw new Error("No fingerprint or face authenticator is available in this browser. Use your account password instead.");
    }

    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing) {
      const credentialId = Uint8Array.from(atob(existing.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((existing.length + 3) % 4)), c => c.charCodeAt(0));
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge: randomBytes(32),
          rpId: location.hostname,
          allowCredentials: [{ type: "public-key", id: credentialId }],
          userVerification: "required",
          timeout: 60000
        }
      });
      if (!assertion) throw new Error("Biometric verification was cancelled.");
      return { registered: false };
    }

    let userId = localStorage.getItem(USER_KEY);
    if (!userId) {
      userId = b64url(randomBytes(32));
      localStorage.setItem(USER_KEY, userId);
    }
    const userIdBytes = Uint8Array.from(atob(userId.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((userId.length + 3) % 4)), c => c.charCodeAt(0));
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: randomBytes(32),
        rp: { name: "H&E | Our Little World", id: location.hostname },
        user: { id: userIdBytes, name: "H&E device user", displayName: "H&E device user" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          residentKey: "preferred",
          userVerification: "required"
        },
        timeout: 60000,
        attestation: "none"
      }
    });
    if (!credential) throw new Error("Biometric setup was cancelled.");
    localStorage.setItem(STORAGE_KEY, b64url(credential.rawId));
    return { registered: true };
  }

  window.HEBiometric = { supported, registerOrVerify };
})();
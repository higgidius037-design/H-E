const SUPABASE_URL = "https://tqhvlazzvypbqrsjqmwz.supabase.co";
const SUPABASE_PUBLIC_KEY = "YOUR_EXISTING_PUBLISHABLE_KEY";

if (!window.supabase || typeof window.supabase.createClient !== "function") {
  const feedback = document.getElementById("loginFeedback");
  if (feedback) {
    feedback.textContent = "Secure sign-in could not load. Check your connection and refresh.";
    feedback.hidden = false;
  }
  return;
}

const db = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLIC_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      experimental: { passkey: true }
    }
  }
);

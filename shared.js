
(() => {
  "use strict";

  // Supabase project configuration
  const SUPABASE_URL = "https://tqhvlazzvypbqrsjqmwz.supabase.co";

  // IMPORTANT: Replace this placeholder with your actual
  // Supabase Publishable Key from Project Settings → API Keys.
  const SUPABASE_PUBLIC_KEY = "YOUR_EXISTING_PUBLISHABLE_KEY";

  // Display an error on the login screen
  function showSupabaseError(message) {
    const feedback = document.getElementById("loginFeedback");

    if (feedback) {
      feedback.textContent = message;
      feedback.hidden = false;
    }

    console.error("H&E Supabase:", message);
  }

  // Check whether the Supabase library loaded
  if (
    !window.supabase ||
    typeof window.supabase.createClient !== "function"
  ) {
    showSupabaseError(
      "Secure sign-in could not load. Check your internet connection and refresh."
    );
    return;
  }

  // Prevent accidental duplicate client creation
  if (window.heSupabase) {
    console.info("H&E Supabase client already initialized.");
    return;
  }

  try {
    // Create the Supabase client
    const db = window.supabase.createClient(
      SUPABASE_URL,
      SUPABASE_PUBLIC_KEY,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storage: window.localStorage
        }
      }
    );

    // Make the client available to the main H&E application
    window.heSupabase = db;

    // Confirm successful initialization
    window.dispatchEvent(
      new CustomEvent("he-supabase-ready")
    );

    console.info("H&E Supabase initialized successfully.");

  } catch (error) {
    console.error("H&E Supabase initialization failed:", error);

    showSupabaseError(
      "Unable to initialize secure sign-in. Please refresh and try again."
    );
  }
})();

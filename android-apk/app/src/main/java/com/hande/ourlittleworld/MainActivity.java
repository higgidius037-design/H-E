package com.hande.ourlittleworld;

import androidx.fragment.app.FragmentActivity;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.PermissionRequest;
import android.content.pm.PackageManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.media.RingtoneManager;
import android.media.AudioAttributes;
import java.util.concurrent.Executor;

public class MainActivity extends FragmentActivity {
    private static final String APP_URL = "https://higgidius037-design.github.io/H-E/H%26E/index.html?android=1&appversion=1.1.7";
    private static final int FILE_CHOOSER_REQUEST = 1001;
    private static final String CHANNEL_ID = "he_messages_v2";
    private static final String CALL_CHANNEL_ID = "he_calls_v1";
    private String pendingCallAction = "";
    private boolean pageReady = false;
    private static final int APP_PERMISSION_REQUEST = 2003;
    private String pendingAppPermission = "";
    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private BiometricPrompt biometricPrompt;
    private static final int CALL_PERMISSION_REQUEST = 2002;
    private PermissionRequest pendingWebPermissionRequest;
    private String[] pendingAndroidPermissions = new String[0];
    private long lastPausedAt = 0L;
    private static final long AUTO_REFRESH_AFTER_MS = 30_000L;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        createNotificationChannel();
        webView = new WebView(this);
        webView.setBackgroundColor(0xFFFFF9F1);
        setContentView(webView);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setLoadsImagesAutomatically(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, true);
        webView.addJavascriptInterface(new HENativeBridge(), "HENative");
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri=request.getUrl(); String host=uri.getHost();
                if(host!=null&&(host.equals("higgidius037-design.github.io")||host.endsWith(".supabase.co"))) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW,uri)); }
                catch(ActivityNotFoundException e){Toast.makeText(MainActivity.this,"No app can open this link.",Toast.LENGTH_SHORT).show();}
                return true;
            }
            @Override public void onPageStarted(WebView view,String url,Bitmap favicon){pageReady=false;view.setBackgroundColor(0xFFFFF9F1);}
            @Override public void onPageFinished(WebView view,String url){pageReady=true;dispatchPendingCallAction();}
            @Override public void onReceivedError(WebView view,WebResourceRequest request,WebResourceError error){if(request.isForMainFrame())showLoadError();}
        });
        webView.setWebChromeClient(new WebChromeClient(){
            @Override public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> handleWebPermissionRequest(request));
            }
            @Override public void onPermissionRequestCanceled(PermissionRequest request) {
                if (pendingWebPermissionRequest == request) pendingWebPermissionRequest = null;
            }
            @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params){
                if(fileCallback!=null)fileCallback.onReceiveValue(null);
                fileCallback=callback;
                try {
                    Intent picker=params.createIntent();
                    picker.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    picker.addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
                    startActivityForResult(picker,FILE_CHOOSER_REQUEST);
                } catch(ActivityNotFoundException e) {
                    fileCallback=null;
                    Toast.makeText(MainActivity.this,"No file picker is available.",Toast.LENGTH_SHORT).show();
                    return false;
                }
                return true;
            }
        });
        webView.loadUrl(APP_URL);
        handleCallIntent(getIntent());
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleCallIntent(intent);
    }

    private void handleCallIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getStringExtra("he_call_action");
        if (action == null || action.isEmpty()) return;
        pendingCallAction = action;
        dispatchPendingCallAction();
    }

    private void dispatchPendingCallAction() {
        if (webView == null || !pageReady || pendingCallAction.isEmpty()) return;
        final String action = pendingCallAction;
        pendingCallAction = "";
        webView.post(() -> webView.evaluateJavascript("(()=>{const id=" + org.json.JSONObject.quote("answer".equals(action) ? "acceptCall" : "rejectCall") + ";const el=document.getElementById(id);if(el)el.click();else window.__hePendingCallAction=" + org.json.JSONObject.quote(action) + ";})()", null));
    }

    @Override protected void onPause() {
        lastPausedAt = System.currentTimeMillis();
        super.onPause();
    }

    @Override protected void onResume() {
        super.onResume();
        if (webView != null && lastPausedAt > 0L
                && System.currentTimeMillis() - lastPausedAt >= AUTO_REFRESH_AFTER_MS) {
            lastPausedAt = 0L;
            // A unique query parameter makes WebView request the current HTML instead of reusing a cached page.
            webView.loadUrl(APP_URL + "&apprefresh=" + System.currentTimeMillis());
        }
    }

    private void handleWebPermissionRequest(PermissionRequest request) {
        Uri origin = request.getOrigin();
        String host = origin == null ? null : origin.getHost();
        if (origin == null || !"https".equalsIgnoreCase(origin.getScheme())
                || host == null || !host.equals("higgidius037-design.github.io")) {
            request.deny();
            return;
        }

        java.util.ArrayList<String> needed = new java.util.ArrayList<>();
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)
                    && ContextCompat.checkSelfPermission(this, android.Manifest.permission.RECORD_AUDIO)
                    != PackageManager.PERMISSION_GRANTED
                    && !needed.contains(android.Manifest.permission.RECORD_AUDIO)) {
                needed.add(android.Manifest.permission.RECORD_AUDIO);
            }
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)
                    && ContextCompat.checkSelfPermission(this, android.Manifest.permission.CAMERA)
                    != PackageManager.PERMISSION_GRANTED
                    && !needed.contains(android.Manifest.permission.CAMERA)) {
                needed.add(android.Manifest.permission.CAMERA);
            }
        }

        if (pendingWebPermissionRequest != null && pendingWebPermissionRequest != request) {
            pendingWebPermissionRequest.deny();
        }
        pendingWebPermissionRequest = request;

        if (needed.isEmpty()) {
            request.grant(request.getResources());
            pendingWebPermissionRequest = null;
            return;
        }

        pendingAndroidPermissions = needed.toArray(new String[0]);
        requestPermissions(pendingAndroidPermissions, CALL_PERMISSION_REQUEST);
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == APP_PERMISSION_REQUEST) {
            String key=pendingAppPermission; pendingAppPermission="";
            boolean granted=grantResults.length>0 && grantResults[0]==PackageManager.PERMISSION_GRANTED;
            String safe=org.json.JSONObject.quote(key);
            if(webView!=null) webView.evaluateJavascript("window.onHEPermissionResult && window.onHEPermissionResult("+safe+","+granted+")",null);
            return;
        }
        if (requestCode != CALL_PERMISSION_REQUEST) return;
        PermissionRequest webRequest = pendingWebPermissionRequest;
        pendingWebPermissionRequest = null;
        if (webRequest == null) return;
        boolean audioNeeded = false;
        boolean videoNeeded = false;
        for (String resource : webRequest.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) audioNeeded = true;
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) videoNeeded = true;
        }
        boolean audioGranted = !audioNeeded || ContextCompat.checkSelfPermission(
                this, android.Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
        boolean cameraGranted = !videoNeeded || ContextCompat.checkSelfPermission(
                this, android.Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;

        if (audioGranted && cameraGranted) {
            webRequest.grant(webRequest.getResources());
        } else {
            webRequest.deny();
            String message = !audioGranted
                    ? "Allow H&E microphone access in Android Settings → Apps → H&E → Permissions."
                    : "Allow H&E camera access in Android Settings → Apps → H&E → Permissions.";
            Toast.makeText(this, message, Toast.LENGTH_LONG).show();
        }
    }

    private void createNotificationChannel(){
        if(Build.VERSION.SDK_INT>=Build.VERSION_CODES.O){
            NotificationManager manager=getSystemService(NotificationManager.class);
            NotificationChannel channel=new NotificationChannel(CHANNEL_ID,"H&E messages and reminders",NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("Private message alerts and H&E reminders. Change sound and pop-up behaviour in Android settings.");
            channel.enableVibration(true);
            channel.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION), new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).build());
            manager.createNotificationChannel(channel);
            NotificationChannel calls = new NotificationChannel(CALL_CHANNEL_ID, "H&E incoming calls", NotificationManager.IMPORTANCE_HIGH);
            calls.setDescription("Incoming H&E voice and video calls.");
            calls.enableVibration(true);
            calls.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            calls.setSound(android.net.Uri.parse("android.resource://" + getPackageName() + "/" + R.raw.he_signature_ring), new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
            manager.createNotificationChannel(calls);
        }
    }

    
    private void authenticateBiometric() {
        int authenticators = BiometricManager.Authenticators.BIOMETRIC_WEAK | BiometricManager.Authenticators.BIOMETRIC_STRONG;
        int availability = BiometricManager.from(this).canAuthenticate(authenticators);
        if (availability != BiometricManager.BIOMETRIC_SUCCESS) {
            notifyWebBiometric(false, availability == BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED
                ? "No fingerprint or face is enrolled in Android settings."
                : "Biometric authentication is unavailable on this device.");
            return;
        }
        Executor executor = ContextCompat.getMainExecutor(this);
        biometricPrompt = new BiometricPrompt(this, executor, new BiometricPrompt.AuthenticationCallback() {
            @Override public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                notifyWebBiometric(true, "Device biometric check successful.");
            }
            @Override public void onAuthenticationError(int code, CharSequence message) {
                notifyWebBiometric(false, message == null ? "Biometric check was cancelled." : message.toString());
            }
            @Override public void onAuthenticationFailed() {
                Toast.makeText(MainActivity.this, "Biometric not recognised. Try again.", Toast.LENGTH_SHORT).show();
            }
        });
        BiometricPrompt.PromptInfo prompt = new BiometricPrompt.PromptInfo.Builder()
            .setTitle("H&E security check")
            .setSubtitle("Confirm your identity on this device")
            .setNegativeButtonText("Cancel")
            .setAllowedAuthenticators(authenticators)
            .build();
        biometricPrompt.authenticate(prompt);
    }

    private void notifyWebBiometric(boolean success, String message) {
        String safe = org.json.JSONObject.quote(message == null ? "" : message);
        runOnUiThread(() -> {
            if (webView != null) webView.evaluateJavascript(
                "window.onHENativeBiometricResult && window.onHENativeBiometricResult(" + success + "," + safe + ")", null);
        });
    }

    private class HENativeBridge {
        @JavascriptInterface public void requestAppPermission(String permission){
            runOnUiThread(()->{
                String androidPermission;
                if("notifications".equals(permission)){androidPermission="android.permission.POST_NOTIFICATIONS";}
                else if("microphone".equals(permission)){androidPermission=android.Manifest.permission.RECORD_AUDIO;}
                else if("camera".equals(permission)){androidPermission=android.Manifest.permission.CAMERA;}
                else return;
                if(Build.VERSION.SDK_INT<23 || checkSelfPermission(androidPermission)==PackageManager.PERMISSION_GRANTED){
                    String safe=org.json.JSONObject.quote(permission); if(webView!=null)webView.evaluateJavascript("window.onHEPermissionResult && window.onHEPermissionResult("+safe+",true)",null); return;
                }
                pendingAppPermission=permission; requestPermissions(new String[]{androidPermission},APP_PERMISSION_REQUEST);
            });
        }
        @JavascriptInterface public void authenticateBiometric(){ runOnUiThread(() -> MainActivity.this.authenticateBiometric()); }
        @JavascriptInterface public void openBiometricSettings(){
            runOnUiThread(()->{
                Intent intent;
                if(Build.VERSION.SDK_INT>=30){
                    intent=new Intent(Settings.ACTION_BIOMETRIC_ENROLL);
                    intent.putExtra(Settings.EXTRA_BIOMETRIC_AUTHENTICATORS_ALLOWED,
                        BiometricManager.Authenticators.BIOMETRIC_STRONG);
                } else {
                    intent=new Intent(Settings.ACTION_SECURITY_SETTINGS);
                }
                try { startActivity(intent); }
                catch(ActivityNotFoundException e) {
                    try { startActivity(new Intent(Settings.ACTION_SECURITY_SETTINGS)); }
                    catch(ActivityNotFoundException ignored) {
                        Toast.makeText(MainActivity.this,"Open Android Settings → Security to manage fingerprints.",Toast.LENGTH_LONG).show();
                    }
                }
            });
        }
        @JavascriptInterface public void showNotification(String title,String body){
            runOnUiThread(()->{
                if(Build.VERSION.SDK_INT>=33 && checkSelfPermission("android.permission.POST_NOTIFICATIONS")!=android.content.pm.PackageManager.PERMISSION_GRANTED){
                    requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"},2001); return;
                }
                Intent launch=new Intent(MainActivity.this,MainActivity.class);
                PendingIntent pending=PendingIntent.getActivity(MainActivity.this,0,launch,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
                Notification.Builder builder=Build.VERSION.SDK_INT>=26?new Notification.Builder(MainActivity.this,CHANNEL_ID):new Notification.Builder(MainActivity.this);
                builder.setSmallIcon(getApplicationInfo().icon).setContentTitle(title==null||title.isEmpty()?"H&E":title).setContentText(body==null?"":body).setAutoCancel(true).setContentIntent(pending).setPriority(Notification.PRIORITY_HIGH);
                getSystemService(NotificationManager.class).notify((int)(System.currentTimeMillis()%Integer.MAX_VALUE),builder.build());
            });
        }
        @JavascriptInterface public void showIncomingCall(String caller, String callType) {
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
                    requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 2001);
                    return;
                }
                String name = caller == null || caller.trim().isEmpty() ? "Your H&E contact" : caller.trim();
                Intent open = new Intent(MainActivity.this, MainActivity.class);
                open.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                PendingIntent content = PendingIntent.getActivity(MainActivity.this, 3101, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                Intent answerIntent = new Intent(MainActivity.this, MainActivity.class);
                answerIntent.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                answerIntent.putExtra("he_call_action", "answer");
                PendingIntent answer = PendingIntent.getActivity(MainActivity.this, 3102, answerIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                Intent declineIntent = new Intent(MainActivity.this, MainActivity.class);
                declineIntent.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                declineIntent.putExtra("he_call_action", "decline");
                PendingIntent decline = PendingIntent.getActivity(MainActivity.this, 3103, declineIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(MainActivity.this, CALL_CHANNEL_ID) : new Notification.Builder(MainActivity.this);
                builder.setSmallIcon(getApplicationInfo().icon).setContentTitle(name + " is calling")
                    .setContentText("Incoming " + ("video".equals(callType) ? "video" : "voice") + " call")
                    .setCategory(Notification.CATEGORY_CALL).setVisibility(Notification.VISIBILITY_PUBLIC)
                    .setOngoing(true).setAutoCancel(false).setContentIntent(content)
                    .addAction(android.R.drawable.sym_action_call, "Answer", answer)
                    .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Decline", decline)
                    .setPriority(Notification.PRIORITY_MAX);
                if (Build.VERSION.SDK_INT >= 29) builder.setFullScreenIntent(content, true);
                getSystemService(NotificationManager.class).notify(3101, builder.build());
            });
        }
        @JavascriptInterface public void openNotificationSettings(){
            runOnUiThread(()->{
                Intent intent=Build.VERSION.SDK_INT>=26?new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE,getPackageName()).putExtra(Settings.EXTRA_CHANNEL_ID,CHANNEL_ID):new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra("app_package",getPackageName()).putExtra("app_uid",getApplicationInfo().uid);
                startActivity(intent);
            });
        }
    }

    private void showLoadError(){
        if(webView==null)return;
        String html="<html><body style='font-family:Arial;background:#fff9f1;color:#310b14;padding:32px;text-align:center'><h2>H&amp;E could not connect</h2><p>Check your internet connection, then try again.</p><button onclick=\"location.href='"+APP_URL+"'\">Try again</button></body></html>";
        webView.loadDataWithBaseURL(APP_URL,html,"text/html","UTF-8",null);
    }
    @Override protected void onActivityResult(int requestCode,int resultCode,Intent data){
        super.onActivityResult(requestCode,resultCode,data);
        if(requestCode==FILE_CHOOSER_REQUEST&&fileCallback!=null){
            Uri[] results=null;
            if(resultCode==RESULT_OK&&data!=null){
                if(data.getClipData()!=null){
                    android.content.ClipData clip=data.getClipData();
                    results=new Uri[clip.getItemCount()];
                    for(int i=0;i<clip.getItemCount();i++) results[i]=clip.getItemAt(i).getUri();
                } else if(data.getData()!=null) {
                    results=new Uri[]{data.getData()};
                }
                if(results!=null && Build.VERSION.SDK_INT>=19){
                    for(Uri uri:results){
                        try{getContentResolver().takePersistableUriPermission(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION);}
                        catch(SecurityException ignored){}
                    }
                }
            }
            fileCallback.onReceiveValue(results);
            fileCallback=null;
        }
    }
    @Override public void onBackPressed(){if(webView!=null&&webView.canGoBack())webView.goBack();else super.onBackPressed();}
    @Override protected void onDestroy(){if(fileCallback!=null)fileCallback.onReceiveValue(null);if(webView!=null){webView.stopLoading();webView.destroy();webView=null;}super.onDestroy();}
}
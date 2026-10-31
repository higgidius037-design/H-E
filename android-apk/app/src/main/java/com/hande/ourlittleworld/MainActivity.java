package com.hande.ourlittleworld;

import android.app.Activity;
import android.app.NotificationManager;
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
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;

public class MainActivity extends Activity {
    private static final String APP_URL = "https://higgidius037-design.github.io/H-E/H%26E/index.html?android=1";
    private static final int FILE_CHOOSER_REQUEST = 1001;
    private static final String CHANNEL_ID = "he_messages";
    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;

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
            @Override public void onPageStarted(WebView view,String url,Bitmap favicon){view.setBackgroundColor(0xFFFFF9F1);}
            @Override public void onReceivedError(WebView view,WebResourceRequest request,WebResourceError error){if(request.isForMainFrame())showLoadError();}
        });
        webView.setWebChromeClient(new WebChromeClient(){
            @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params){
                if(fileCallback!=null)fileCallback.onReceiveValue(null); fileCallback=callback;
                try{startActivityForResult(params.createIntent(),FILE_CHOOSER_REQUEST);}
                catch(ActivityNotFoundException e){fileCallback=null;Toast.makeText(MainActivity.this,"No file picker is available.",Toast.LENGTH_SHORT).show();return false;}
                return true;
            }
        });
        webView.loadUrl(APP_URL);
    }

    private void createNotificationChannel(){
        if(Build.VERSION.SDK_INT>=Build.VERSION_CODES.O){
            NotificationManager manager=getSystemService(NotificationManager.class);
            NotificationChannel channel=new NotificationChannel(CHANNEL_ID,"H&E messages and reminders",NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("Private message alerts and H&E reminders. Change sound and pop-up behaviour in Android settings.");
            channel.enableVibration(true);
            manager.createNotificationChannel(channel);
        }
    }

    private class HENativeBridge {
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
        if(requestCode==FILE_CHOOSER_REQUEST&&fileCallback!=null){fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode,data));fileCallback=null;}
    }
    @Override public void onBackPressed(){if(webView!=null&&webView.canGoBack())webView.goBack();else super.onBackPressed();}
    @Override protected void onDestroy(){if(fileCallback!=null)fileCallback.onReceiveValue(null);if(webView!=null){webView.stopLoading();webView.destroy();webView=null;}super.onDestroy();}
}
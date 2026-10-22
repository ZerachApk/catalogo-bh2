package com.brasilhomens.catalogo;

import android.app.Activity;
import android.app.ActivityManager;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.os.Build;
import android.view.WindowManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Liga e desliga o modo quiosco (lock task) do Android. */
@CapacitorPlugin(name = "Kiosk")
public class KioskPlugin extends Plugin {

    private JSObject status() {
        Activity a = getActivity();
        JSObject o = new JSObject();
        boolean owner = false;
        boolean locked = false;
        try {
            DevicePolicyManager dpm = (DevicePolicyManager) a.getSystemService(Context.DEVICE_POLICY_SERVICE);
            owner = dpm != null && dpm.isDeviceOwnerApp(a.getPackageName());
            ActivityManager am = (ActivityManager) a.getSystemService(Context.ACTIVITY_SERVICE);
            locked = am != null && am.getLockTaskModeState() != ActivityManager.LOCK_TASK_MODE_NONE;
        } catch (Exception ignored) {
        }
        o.put("deviceOwner", owner);
        o.put("locked", locked);
        return o;
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(status());
    }

    @PluginMethod
    public void enable(final PluginCall call) {
        final Activity a = getActivity();
        final boolean secure = Boolean.TRUE.equals(call.getBoolean("secure", false));
        a.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    if (secure) {
                        a.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
                    } else {
                        a.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
                    }
                    DevicePolicyManager dpm = (DevicePolicyManager) a.getSystemService(Context.DEVICE_POLICY_SERVICE);
                    String pkg = a.getPackageName();
                    if (dpm != null && dpm.isDeviceOwnerApp(pkg)) {
                        ComponentName admin = new ComponentName(a, KioskAdminReceiver.class);
                        dpm.setLockTaskPackages(admin, new String[]{pkg});
                        if (Build.VERSION.SDK_INT >= 28) {
                            dpm.setLockTaskFeatures(admin, DevicePolicyManager.LOCK_TASK_FEATURE_NONE);
                        }
                    }
                    a.startLockTask();
                    call.resolve(status());
                } catch (Exception e) {
                    call.reject(String.valueOf(e.getMessage()));
                }
            }
        });
    }

    @PluginMethod
    public void disable(final PluginCall call) {
        final Activity a = getActivity();
        a.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    a.stopLockTask();
                } catch (Exception ignored) {
                }
                call.resolve(status());
            }
        });
    }
}

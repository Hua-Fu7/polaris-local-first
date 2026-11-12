package com.alyssa.polaris;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * 「Ombre-Brain 密码」这类敏感值的存放处。
 *
 * 密钥由 Android Keystore 生成并保管（永远不出安全硬件/系统密钥库），
 * 密文和 IV 放在普通的 SharedPreferences 里——即使有人翻到文件，也解不开。
 *
 * 只暴露三个方法：read / write / remove。没有「列出所有键」之类的接口，
 * 免得以后有人拿它当通用密钥库乱塞东西。
 */
@CapacitorPlugin(name = "ObSecretStore")
public class ObSecretStorePlugin extends Plugin {

    private static final String PREFS_NAME = "polaris_ob_secret";
    private static final String KEY_ALIAS = "polaris_ob_secret_key";
    private static final String PREF_IV = "iv";
    private static final String PREF_CIPHERTEXT = "ciphertext";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    private SecretKey key() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (!keyStore.containsAlias(KEY_ALIAS)) {
            KeyGenerator generator = KeyGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build());
            generator.generateKey();
        }
        return (SecretKey) keyStore.getKey(KEY_ALIAS, null);
    }

    @PluginMethod
    public void read(PluginCall call) {
        JSObject result = new JSObject();
        SharedPreferences preferences = prefs();
        String ivBase64 = preferences.getString(PREF_IV, null);
        String cipherBase64 = preferences.getString(PREF_CIPHERTEXT, null);
        if (ivBase64 == null || cipherBase64 == null) {
            result.put("value", JSObject.NULL);
            call.resolve(result);
            return;
        }
        try {
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(
                Cipher.DECRYPT_MODE,
                key(),
                new GCMParameterSpec(128, Base64.decode(ivBase64, Base64.NO_WRAP)));
            byte[] plain = cipher.doFinal(Base64.decode(cipherBase64, Base64.NO_WRAP));
            result.put("value", new String(plain, StandardCharsets.UTF_8));
        } catch (Exception error) {
            // 密钥被系统换了、或者数据坏了：当作没有，下一次写入会重新生成。
            result.put("value", JSObject.NULL);
        }
        call.resolve(result);
    }

    @PluginMethod
    public void write(PluginCall call) {
        String value = call.getString("value");
        if (value == null || value.isEmpty()) {
            call.reject("value 不能为空");
            return;
        }
        try {
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, key());
            byte[] cipherBytes = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
            prefs().edit()
                .putString(PREF_IV, Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
                .putString(PREF_CIPHERTEXT, Base64.encodeToString(cipherBytes, Base64.NO_WRAP))
                .apply();
            call.resolve();
        } catch (Exception error) {
            call.reject("保存密码失败：" + error.getMessage());
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        prefs().edit().remove(PREF_IV).remove(PREF_CIPHERTEXT).apply();
        call.resolve();
    }
}

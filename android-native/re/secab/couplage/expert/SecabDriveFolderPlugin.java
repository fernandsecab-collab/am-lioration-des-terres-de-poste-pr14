package re.secab.couplage.expert;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import androidx.documentfile.provider.DocumentFile;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;

@CapacitorPlugin(name = "SecabDriveFolder")
public class SecabDriveFolderPlugin extends Plugin {
    private static final String PREFS = "secab_drive_folder";
    private static final String KEY_URI = "tree_uri";

    @PluginMethod
    public void chooseFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        startActivityForResult(call, intent, "folderPicked");
    }

    @ActivityCallback
    private void folderPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("Sélection du dossier annulée"); return;
        }
        Uri uri = result.getData().getData();
        int flags = result.getData().getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        try { getContext().getContentResolver().takePersistableUriPermission(uri, flags); } catch (Exception ignored) {}
        getContext().getSharedPreferences(PREFS, Activity.MODE_PRIVATE).edit().putString(KEY_URI, uri.toString()).apply();
        DocumentFile folder = DocumentFile.fromTreeUri(getContext(), uri);
        JSObject out = new JSObject(); out.put("uri", uri.toString()); out.put("name", folder != null ? folder.getName() : "Dossier Google Drive"); call.resolve(out);
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        String uriText = getContext().getSharedPreferences(PREFS, Activity.MODE_PRIVATE).getString(KEY_URI, "");
        JSObject out = new JSObject();
        if (uriText == null || uriText.isEmpty()) { out.put("configured", false); call.resolve(out); return; }
        try {
            DocumentFile folder = DocumentFile.fromTreeUri(getContext(), Uri.parse(uriText));
            boolean ok = folder != null && folder.exists() && folder.canWrite();
            out.put("configured", ok);
            out.put("uri", uriText);
            out.put("name", folder != null ? folder.getName() : "Dossier Google Drive");
            call.resolve(out);
        } catch (Exception e) { out.put("configured", false); out.put("error", e.getMessage()); call.resolve(out); }
    }

    @PluginMethod
    public void saveFile(PluginCall call) {
        String uriText = call.getString("treeUri", "");
        if (uriText.isEmpty()) uriText = getContext().getSharedPreferences(PREFS, Activity.MODE_PRIVATE).getString(KEY_URI, "");
        String fileName = call.getString("fileName", "affaire.secabpkg");
        String mimeType = call.getString("mimeType", "application/json");
        String base64 = call.getString("base64", "");
        if (uriText.isEmpty()) { call.reject("Dossier Drive non configuré"); return; }
        try {
            DocumentFile folder = DocumentFile.fromTreeUri(getContext(), Uri.parse(uriText));
            if (folder == null || !folder.canWrite()) throw new Exception("Dossier non accessible en écriture");
            DocumentFile target = folder.findFile(fileName);
            if (target == null) target = folder.createFile(mimeType, fileName);
            if (target == null) throw new Exception("Impossible de créer le fichier");
            byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
            try (OutputStream out = getContext().getContentResolver().openOutputStream(target.getUri(), "wt")) {
                if (out == null) throw new Exception("Flux d’écriture indisponible");
                out.write(bytes); out.flush();
            }
            JSObject result = new JSObject(); result.put("ok", true); result.put("uri", target.getUri().toString()); result.put("fileName", fileName); call.resolve(result);
        } catch (Exception e) { call.reject("Écriture Drive impossible : " + e.getMessage(), e); }
    }
}

package expo.modules.smsreader

import android.provider.Telephony
import com.google.zxing.integration.android.IntentIntegrator
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SmsReaderModule : Module() {
  // waits for the scanner screen to close
  private var scanPromise: Promise? = null

  override fun definition() = ModuleDefinition {
    Name("SmsReader")

    AsyncFunction("getInbox") { limit: Int, sinceMs: Double ->
      val ctx = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val out = mutableListOf<Map<String, Any?>>()
      ctx.contentResolver.query(
        Telephony.Sms.Inbox.CONTENT_URI,
        arrayOf(Telephony.Sms._ID, Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE),
        "${Telephony.Sms.DATE} > ?",
        arrayOf(sinceMs.toLong().toString()),
        "${Telephony.Sms.DATE} DESC"
      )?.use { c ->
        while (c.moveToNext() && out.size < limit) {
          out.add(mapOf(
            "id" to c.getString(0),
            "address" to c.getString(1),
            "body" to c.getString(2),
            "date" to c.getLong(3).toDouble()
          ))
        }
      }
      out
    }

    // opens a full screen qr scanner, gives back the text or null if closed
    AsyncFunction("scanQr") { promise: Promise ->
      val activity = appContext.activityProvider?.currentActivity ?: appContext.currentActivity
      if (activity == null) {
        promise.reject(CodedException("Salli screen not ready, try again"))
        return@AsyncFunction
      }
      scanPromise = promise
      IntentIntegrator(activity)
        .setDesiredBarcodeFormats(IntentIntegrator.QR_CODE)
        .setPrompt("Point at the QR code on your laptop")
        .setBeepEnabled(false)
        .setOrientationLocked(false)
        .initiateScan()
    }.runOnQueue(Queues.MAIN)

    OnActivityResult { _, payload ->
      if (payload.requestCode != IntentIntegrator.REQUEST_CODE) return@OnActivityResult
      val result = IntentIntegrator.parseActivityResult(payload.resultCode, payload.data)
      scanPromise?.resolve(result?.contents)
      scanPromise = null
    }
  }
}

package expo.modules.smsreader

import android.provider.Telephony
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SmsReaderModule : Module() {
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
  }
}

package expo.modules.ralphnotify

import android.content.Context
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class SessionRecord : Record {
  @Field val token: String = ""

  @Field val apiBaseUrl: String = ""

  @Field val userId: String = ""

  @Field val userName: String = ""

  @Field val userAvatar: String? = null

  @Field val scheme: String = ""
}

/**
 * JS's side of the native message notifications: mirror the session for the
 * FCM service and the notification actions, say which conversation is on
 * screen, and take a conversation's notifications down once it is read.
 */
class RalphNotifyModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context is gone" }.applicationContext

  override fun definition() =
    ModuleDefinition {
      Name("RalphNotify")

      OnCreate { appContext.reactContext?.let { MessageNotifier.ensureChannels(it) } }

      Function("setSession") { session: SessionRecord ->
        Session.save(
          context,
          Session(
            token = session.token,
            apiBaseUrl = session.apiBaseUrl.trimEnd('/'),
            userId = session.userId,
            userName = session.userName,
            userAvatar = session.userAvatar,
            scheme = session.scheme,
          ),
        )
      }

      Function("clearSession") {
        Session.clear(context)
        MessageNotifier.forgetAll(context)
      }

      Function("setActiveConversation") { channelId: String? ->
        MessageNotifier.activeConversation = channelId
      }

      Function("clearConversation") { channelId: String ->
        MessageNotifier.cancel(context, channelId)
      }

      Function("clearAll") { MessageNotifier.cancelAll(context) }
    }
}

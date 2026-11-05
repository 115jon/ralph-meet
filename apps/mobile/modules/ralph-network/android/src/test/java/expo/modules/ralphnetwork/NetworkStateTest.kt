package expo.modules.ralphnetwork

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DefaultNetworkStateTest {
  @Test
  fun launchedOnlineTheFirstNetworkIsNoChange() {
    val state = DefaultNetworkState<String>(initiallyConnected = true)
    assertFalse(state.available("wifi"))
    assertTrue(state.connected)
  }

  @Test
  fun launchedOfflineTheFirstNetworkIsAChange() {
    val state = DefaultNetworkState<String>(initiallyConnected = false)
    assertFalse(state.connected)
    assertTrue(state.available("wifi"))
    assertTrue(state.connected)
  }

  @Test
  fun aLossAndAReturnAreChanges() {
    val state = DefaultNetworkState<String>(initiallyConnected = true)
    state.available("wifi")
    assertFalse(state.lost("cellular"))
    assertTrue(state.lost("wifi"))
    assertFalse(state.connected)
    assertTrue(state.available("cellular"))
    assertTrue(state.connected)
  }

  @Test
  fun aSwitchWithNoLossIsAChange() {
    val state = DefaultNetworkState<String>(initiallyConnected = true)
    state.available("wifi")
    assertFalse(state.available("wifi"))
    assertTrue(state.available("cellular"))
  }
}

class CancelsCallTest {
  private val tickets = listOf("/api/voice/socket-ticket", "/api/voice/admission")

  @Test
  fun aNetworkChangeCancelsEveryHttpCall() {
    assertTrue(cancelsCall("/api/attachments", null, null))
    assertTrue(cancelsCall("/api/voice/admission", null, null))
  }

  @Test
  fun aStalledTicketCancelsOnlyTicketRequests() {
    assertTrue(cancelsCall("/api/voice/socket-ticket", null, tickets))
    assertTrue(cancelsCall("/api/voice/admission", null, tickets))
    assertFalse(cancelsCall("/api/attachments", null, tickets))
    assertFalse(cancelsCall("/cdn/avatar.png", null, tickets))
  }

  @Test
  fun webSocketsAreNeverCancelled() {
    assertFalse(cancelsCall("/api/gateway", "websocket", null))
    assertFalse(cancelsCall("/api/voice/socket-ticket", "WebSocket", tickets))
    assertEquals(true, cancelsCall("/api/gateway", "h2c", null))
  }
}

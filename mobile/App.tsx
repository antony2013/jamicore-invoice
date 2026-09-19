import React, { useState, useEffect } from "react";
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
  Platform,
  Image,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import Constants from "expo-constants";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import * as ImagePicker from "expo-image-picker";
import {
  loginWithPassword,
  logout,
  getUploadUrl,
  getMyInvoices,
  getMyOutlets,
  buildInvoicePdf,
  uploadBytesToS3,
  confirmInvoiceUpload,
  setApiBaseUrl,
  getApiBaseUrl,
  loadPersistedToken,
} from "./src/services/api";

/* ------------------------------------------------------------------ */
/* Liquid Glass design language (iOS 26 inspired, built with expo-blur */
/* + translucency): deep-space backdrop, aurora light blobs, frosted   */
/* glass cards in a shared container, tinted interactive pills.        */
/* ------------------------------------------------------------------ */

type HistoryInvoice = {
  id: string;
  status: string;
  priority: string;
  outlet: { id: string; name: string } | null;
  ocrData: { amount?: number | string | null; invoiceNo?: string | null; vendor?: string | null; date?: string | null; confidence?: number | null } | null;
  createdAt: string;
  updatedAt: string;
  statusLogs: Array<{ status: string; note?: string | null; timestamp: string }>;
};

const STATUS_TINT: Record<string, { bg: string; fg: string }> = {
  uploaded: { bg: "rgba(148,163,184,0.16)", fg: "#CBD5E1" },
  ocr_pending: { bg: "rgba(245,158,11,0.18)", fg: "#FCD34D" },
  ocr_done: { bg: "rgba(56,189,248,0.18)", fg: "#7DD3FC" },
  ocr_failed: { bg: "rgba(248,113,113,0.18)", fg: "#FCA5A5" },
  assigned: { bg: "rgba(167,139,250,0.20)", fg: "#C4B5FD" },
  in_review: { bg: "rgba(129,140,248,0.20)", fg: "#A5B4FC" },
  needs_info: { bg: "rgba(251,146,60,0.20)", fg: "#FDBA74" },
  verified: { bg: "rgba(45,212,191,0.18)", fg: "#5EEAD4" },
  collected: { bg: "rgba(52,211,153,0.20)", fg: "#6EE7B7" },
  disputed: { bg: "rgba(251,113,133,0.20)", fg: "#FDA4AF" },
};

/** Frosted glass card — the base Liquid Glass surface. */
function GlassCard({ children, style }: { children: React.ReactNode; style?: any }) {
  return (
    <View style={[styles.glassOuter, style]}>
      <BlurView intensity={48} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={styles.glassInner}>{children}</View>
    </View>
  );
}

/** Tinted status pill (glassEffect .tint + shape analog). */
function StatusPill({ status }: { status: string }) {
  const t = STATUS_TINT[status] || STATUS_TINT.uploaded;
  return (
    <View style={[styles.statusPill, { backgroundColor: t.bg, borderColor: `${t.fg}66` }]}>
      <Text style={[styles.statusPillText, { color: t.fg }]}>{status.replace(/_/g, " ")}</Text>
    </View>
  );
}

/** Prominent gradient action button (glassProminent analog). */
function PrimaryButton({
  title,
  onPress,
  disabled,
  loading,
  loadingText,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  loadingText?: string;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.85}
      style={[styles.primaryWrap, disabled && styles.buttonDisabled]}
    >
      <LinearGradient
        colors={["#FBBF24", "#F97316"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.primaryGradient}
      >
        {loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color="#1C0A00" size="small" />
            <Text style={styles.primaryLoadingText}>{loadingText || "Working..."}</Text>
          </View>
        ) : (
          <Text style={styles.primaryText}>{title}</Text>
        )}
      </LinearGradient>
    </TouchableOpacity>
  );
}

/** Quiet glass button (.glass buttonStyle analog). */
function GlassButton({
  title,
  onPress,
  disabled,
  loading,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
      style={[styles.glassBtnOuter, disabled && styles.buttonDisabled]}
    >
      <BlurView intensity={36} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={styles.glassBtnInner}>
        {loading ? (
          <ActivityIndicator color="#E2E8F0" size="small" />
        ) : (
          <Text style={styles.glassBtnText}>{title}</Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

export default function App() {
  // Navigation: login -> outlet gate (if 2+ outlets) -> scan <-> history -> success
  const [screen, setScreen] = useState<"login" | "outlet" | "scan" | "success" | "history">("login");
  // Admin-provided credentials (no OTP)
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [client, setClient] = useState<{ id: string; name: string; username?: string | null } | null>(null);
  // Multi-page invoice (Adobe Scan style): one or more photos -> single PDF.
  // Each page carries its own note (per-snap notes, since pages differ).
  const [pages, setPages] = useState<Array<{ uri: string; note: string }>>([]);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  // Outlets of this client (for tagging uploads). 0 = none yet, 1 = auto,
  // 2+ = client must pick one per upload.
  const [outlets, setOutlets] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedOutletId, setSelectedOutletId] = useState<string | null>(null);
  // History state
  const [history, setHistory] = useState<HistoryInvoice[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Restore persisted JWT (SecureStore) on launch
  useEffect(() => {
    loadPersistedToken().catch(() => undefined);
  }, []);

  // Backend URL settings
  const [serverUrl, setServerUrlState] = useState(getApiBaseUrl());
  const [showServerConfig, setShowServerConfig] = useState(false);

  const handleUpdateServerUrl = () => {
    setApiBaseUrl(serverUrl);
    setShowServerConfig(false);
    Alert.alert("Server Updated", `API connected to: ${getApiBaseUrl()}`);
  };

  // 1. Login with admin-provided user ID + password
  const handleLogin = async () => {
    if (!username.trim() || !password) {
      Alert.alert("Validation", "Please enter your user ID and password.");
      return;
    }
    setLoading(true);
    try {
      const data = await loginWithPassword(username.trim(), password);
      setClient(data.client);
      setPassword("");
      // Load own outlets: 0-1 -> straight to scan, 2+ -> outlet gate screen
      // (part of the entry flow, so there's never confusion about context).
      try {
        const own = await getMyOutlets();
        setOutlets(own);
        if (own.length > 1) {
          setSelectedOutletId(null);
          setScreen("outlet");
        } else {
          setSelectedOutletId(own.length === 1 ? own[0].id : null);
          setScreen("scan");
        }
      } catch {
        setOutlets([]);
        setSelectedOutletId(null);
        setScreen("scan");
      }
    } catch (err: any) {
      Alert.alert("Login Failed", err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    setClient(null);
    setUsername("");
    setPages([]);
    setNote("");
    setOutlets([]);
    setSelectedOutletId(null);
    setHistory([]);
    setScreen("login");
  };

  // 2. Load my invoice history (own uploads + status timelines)
  const handleLoadHistory = async () => {
    setHistoryLoading(true);
    try {
      const items = await getMyInvoices();
      setHistory(items);
      setScreen("history");
    } catch (err: any) {
      Alert.alert("History Failed", err.message);
    } finally {
      setHistoryLoading(false);
    }
  };

  // 3. Add a page: document scanner (dev client) or camera/gallery (Expo Go).
  // Appends to the multi-page invoice — upload combines all pages into one PDF.
  const handleAddPage = async () => {
    try {
      let DocumentScanner: any = null;
      // The scanner needs a native dev-client build. Inside Expo Go the
      // native module is absent — don't even require() the package there:
      // its JS calls TurboModuleRegistry.getEnforcing at load time, which
      // redboxes. Go straight to the camera/gallery fallback instead.
      if (Constants.appOwnership !== "expo" && Platform.OS !== "web") {
        try {
          const mod = require("react-native-document-scanner-plugin");
          DocumentScanner = mod?.default ?? mod;
        } catch {
          // Native module not linked (e.g. plain emulator build) — fallback below
          DocumentScanner = null;
        }
      }

      if (DocumentScanner) {
        const { scannedImages } = await DocumentScanner.scanDocument({
          maxNumDocuments: 1,
          letUserAdjustCrop: true,
        });

        if (scannedImages && scannedImages.length > 0) {
          setPages((prev) => [...prev, { uri: scannedImages[0], note: "" }].slice(0, 20));
          return;
        }
      }

      // Camera / Photo Library Picker Fallback for Expo Go or Emulator
      Alert.alert(
        "Add Invoice Page",
        `Page ${pages.length + 1} — choose how to capture it:`,
        [
          {
            text: "Take Photo (Camera)",
            onPress: async () => {
              const permission = await ImagePicker.requestCameraPermissionsAsync();
              if (!permission.granted) {
                Alert.alert("Permission", "Camera permission is required to photograph invoices.");
                return;
              }
              const result = await ImagePicker.launchCameraAsync({
                mediaTypes: ["images"],
                quality: 0.9,
              });
              if (!result.canceled && result.assets && result.assets[0]) {
                setPages((prev) => [...prev, { uri: result.assets[0].uri, note: "" }].slice(0, 20));
              }
            },
          },
          {
            text: "Choose from Gallery",
            onPress: async () => {
              const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ["images"],
                quality: 0.9,
              });
              if (!result.canceled && result.assets && result.assets[0]) {
                setPages((prev) => [...prev, { uri: result.assets[0].uri, note: "" }].slice(0, 20));
              }
            },
          },
          { text: "Cancel", style: "cancel" },
        ]
      );
    } catch (error: any) {
      Alert.alert("Scan Error", error.message || "Failed to scan document.");
    }
  };

  const handleRemovePage = (index: number) => {
    setPages((prev) => prev.filter((_, i) => i !== index));
  };

  const handlePageNote = (index: number, text: string) => {
    setPages((prev) => prev.map((p, i) => (i === index ? { ...p, note: text.slice(0, 500) } : p)));
  };

  // 4. Build single PDF from all pages -> upload bytes to S3 -> confirm.
  // Fire-and-forget: never waits for OCR. Double-tap safe via `uploading`
  // guard + server-side idempotency per s3Key. The PDF travels as in-memory
  // bytes (no device file reads), so cache-permission issues can't break it.
  const handleUploadAndConfirm = async () => {
    if (pages.length === 0 || uploading) return;
    if (outlets.length > 1 && !selectedOutletId) {
      Alert.alert("Outlet Required", "Please select which outlet this invoice is from.");
      return;
    }
    setUploading(true);
    setLoading(true);

    try {
      // 1. Combine pages into one PDF (Adobe Scan style)
      setStatusMessage(`Preparing ${pages.length} page${pages.length === 1 ? "" : "s"}...`);
      const pdf = await buildInvoicePdf(pages, (msg) => setStatusMessage(msg));
      if (pdf.byteLength < 1024) {
        throw new Error("Generated PDF looks empty. Please retake the photos.");
      }

      // 2. Get presigned upload URL for the PDF (with real byte size)
      setStatusMessage("Getting presigned upload URL...");
      const { uploadUrl, s3Key } = await getUploadUrl("application/pdf", pdf.byteLength);

      setStatusMessage("Uploading PDF to private storage...");
      // 3. Direct PUT of PDF bytes to S3
      await uploadBytesToS3(uploadUrl, pdf.base64, "application/pdf");

      setStatusMessage("Confirming upload with server...");
      // 4. Confirm upload (overall note + per-page notes + outlet)
      await confirmInvoiceUpload(
        s3Key,
        note,
        pages.map((p) => p.note),
        selectedOutletId ?? undefined
      );

      // 5. Fire-and-forget confirmation
      setStatusMessage("");
      setPages([]);
      setNote("");
      setScreen("success");
    } catch (error: any) {
      Alert.alert("Upload Failed", error.message);
    } finally {
      setLoading(false);
      setUploading(false);
    }
  };

  const loggedIn = screen !== "login";

  return (
    <SafeAreaProvider>
      <View style={styles.root}>
        {/* Aurora backdrop: deep space + liquid light blobs */}
        <LinearGradient
          colors={["#0B1026", "#060A18", "#0A0F22"]}
          style={StyleSheet.absoluteFill}
        />
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <LinearGradient
            colors={["rgba(99,102,241,0.55)", "rgba(99,102,241,0)"]}
            style={[styles.blob, { top: -90, left: -70, width: 300, height: 300 }]}
          />
          <LinearGradient
            colors={["rgba(34,211,238,0.38)", "rgba(34,211,238,0)"]}
            style={[styles.blob, { top: 130, right: -90, width: 280, height: 280 }]}
          />
          <LinearGradient
            colors={["rgba(249,115,22,0.42)", "rgba(249,115,22,0)"]}
            style={[styles.blob, { bottom: -80, left: 40, width: 320, height: 320 }]}
          />
          <LinearGradient
            colors={["rgba(167,139,250,0.30)", "rgba(167,139,250,0)"]}
            style={[styles.blob, { bottom: 220, right: -70, width: 240, height: 240 }]}
          />
        </View>

        <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
          <StatusBar style="light" />
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.brandRow}>
                <Image
                  source={require("./assets/logo.png")}
                  style={styles.brandLogo}
                  resizeMode="contain"
                />
                <View>
                  <Text style={styles.title}>Invoice Scanner</Text>
                  <Text style={styles.subtitle}>Client Invoice Collection Portal</Text>
                </View>
              </View>

              {/* Server Connection Badge (glass pill) */}
              <TouchableOpacity
                style={styles.serverBadgeOuter}
                onPress={() => setShowServerConfig(!showServerConfig)}
                activeOpacity={0.8}
              >
                <BlurView intensity={32} tint="dark" style={StyleSheet.absoluteFill} />
                <View style={styles.serverBadgeInner}>
                  <View style={styles.dot} />
                  <Text style={styles.serverBadgeText}>API: {getApiBaseUrl()}</Text>
                </View>
              </TouchableOpacity>
            </View>

            {/* Server Config Dropdown */}
            {showServerConfig && (
              <GlassCard style={styles.serverCard}>
                <Text style={styles.label}>Backend Server URL</Text>
                <TextInput
                  style={styles.input}
                  value={serverUrl}
                  onChangeText={setServerUrlState}
                  placeholder="http://192.168.1.13:3000"
                  placeholderTextColor="#64748B"
                  autoCapitalize="none"
                />
                <GlassButton title="Save Server URL" onPress={handleUpdateServerUrl} />
              </GlassCard>
            )}

            {/* Segmented Scan | History control (glass container) */}
            {loggedIn && (screen === "scan" || screen === "history") && (
              <View style={styles.segmentOuter}>
                <BlurView intensity={36} tint="dark" style={StyleSheet.absoluteFill} />
                <View style={styles.segmentInner}>
                  {(["scan", "history"] as const).map((tab) => {
                    const active = screen === tab;
                    return (
                      <TouchableOpacity
                        key={tab}
                        onPress={() => (tab === "history" ? handleLoadHistory() : setScreen("scan"))}
                        activeOpacity={0.85}
                        style={styles.segmentTab}
                      >
                        {active ? (
                          <LinearGradient
                            colors={["rgba(251,191,36,0.9)", "rgba(249,115,22,0.9)"]}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                            style={styles.segmentActive}
                          >
                            <Text style={styles.segmentActiveText}>
                              {tab === "scan" ? "◉  Scan" : "◔  History"}
                            </Text>
                          </LinearGradient>
                        ) : (
                          <View style={styles.segmentIdle}>
                            <Text style={styles.segmentIdleText}>
                              {tab === "scan" ? "◉  Scan" : "◔  History"}
                            </Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}

            {/* Screen 1: User ID + Password Login */}
            {screen === "login" && (
              <GlassCard>
                <View style={styles.loginGlow}>
                  <Image
                    source={require("./assets/logo.png")}
                    style={styles.loginLogo}
                    resizeMode="contain"
                  />
                </View>
                <Text style={styles.cardTitle}>Welcome back</Text>
                <Text style={styles.instruction}>
                  Sign in with the user ID and password provided by your admin.
                </Text>
                <Text style={styles.label}>User ID</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. jane.doe"
                  placeholderTextColor="#64748B"
                  value={username}
                  onChangeText={setUsername}
                  autoCapitalize="none"
                  autoCorrect={false}
                />

                <Text style={styles.label}>Password</Text>
                <TextInput
                  style={styles.input}
                  placeholder="••••••••"
                  placeholderTextColor="#64748B"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoCapitalize="none"
                />

                <PrimaryButton
                  title="Sign In"
                  onPress={handleLogin}
                  disabled={loading}
                  loading={loading}
                  loadingText="Signing in..."
                />
              </GlassCard>
            )}

            {/* Outlet gate: part of entry flow (right after login). Pick once
                here — scan screen always shows the active outlet, no confusion. */}
            {screen === "outlet" && (
              <GlassCard>
                <Text style={styles.cardTitle}>Which outlet?</Text>
                <Text style={styles.instruction}>
                  {client?.name} has {outlets.length} outlets. Pick the shop this
                  session&apos;s invoices belong to — you can change it anytime.
                </Text>
                {outlets.map((o) => {
                  const active = selectedOutletId === o.id;
                  return (
                    <TouchableOpacity
                      key={o.id}
                      onPress={() => {
                        setSelectedOutletId(o.id);
                        setScreen("scan");
                      }}
                      activeOpacity={0.85}
                      style={[styles.gateOutletRow, active && styles.gateOutletRowActive]}
                    >
                      <View style={[styles.gateRadio, active && styles.gateRadioActive]}>
                        {active ? <Text style={styles.gateRadioDot}>●</Text> : null}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.gateOutletName}>{o.name}</Text>
                        <Text style={styles.gateOutletHint}>Tap to continue →</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
                <TouchableOpacity onPress={handleLogout} style={{ marginTop: 14, alignItems: "center" }}>
                  <Text style={styles.linkText}>Log out</Text>
                </TouchableOpacity>
              </GlassCard>
            )}

            {/* Screen 2: Document Scanner & Upload */}
            {screen === "scan" && (
              <GlassCard>
                <View style={styles.userBadgeRow}>
                  <View style={styles.userBadge}>
                    <Text style={styles.userBadgeText}>◍ {client?.name}</Text>
                  </View>
                  <TouchableOpacity onPress={handleLogout}>
                    <Text style={styles.linkText}>Log out</Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.cardTitle}>Scan Invoice</Text>
                <Text style={styles.instruction}>
                  Add pages — combined into one PDF. Write a note under each page.
                </Text>

                {outlets.length > 1 && (
                  <TouchableOpacity
                    style={styles.outletBar}
                    onPress={() => setScreen("outlet")}
                    activeOpacity={0.85}
                  >
                    <View style={styles.outletBarDot} />
                    <Text style={styles.outletBarText} numberOfLines={1}>
                      {selectedOutletId
                        ? `◍ ${outlets.find((o) => o.id === selectedOutletId)?.name || "Outlet"}`
                        : "No outlet selected"}
                    </Text>
                    <Text style={styles.outletBarChange}>Change</Text>
                  </TouchableOpacity>
                )}
                {outlets.length === 1 && (
                  <View style={styles.outletFixed}>
                    <Text style={styles.outletFixedText}>◍ Outlet: {outlets[0].name}</Text>
                  </View>
                )}

                {pages.length > 0 && (
                  <View style={styles.pagesGrid}>
                    {pages.map((page, i) => (
                      <View
                        key={`${i}-${page.uri}`}
                        style={styles.pageThumb}
                      >
                        <Image source={{ uri: page.uri }} style={styles.pageThumbImage} />
                        <LinearGradient
                          colors={["transparent", "rgba(0,0,0,0.55)"]}
                          style={styles.pageShade}
                        />
                        <Text style={styles.pageNumber}>{i + 1}</Text>
                        {page.note.trim() ? <Text style={styles.pageNoteBadge}>📝</Text> : null}
                        <TouchableOpacity
                          style={styles.pageRemove}
                          onPress={() => handleRemovePage(i)}
                        >
                          <Text style={styles.pageRemoveText}>✕</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )}

                {pages.length > 0 && (
                  <View style={styles.pageNotesList}>
                    <Text style={styles.label}>Notes — one per page</Text>
                    {pages.map((page, i) => (
                      <View key={`note-${i}-${page.uri}`} style={styles.pageNoteRow}>
                        <Image source={{ uri: page.uri }} style={styles.pageNoteThumb} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.pageNoteTitle}>Page {i + 1}</Text>
                          <TextInput
                            style={[styles.input, styles.pageNoteInput]}
                            placeholder={`Note for page ${i + 1} (optional)…`}
                            placeholderTextColor="#64748B"
                            value={page.note}
                            onChangeText={(t) => handlePageNote(i, t)}
                            multiline
                            maxLength={500}
                          />
                        </View>
                      </View>
                    ))}
                  </View>
                )}

                <TouchableOpacity
                  style={styles.scanPlaceholderOuter}
                  onPress={handleAddPage}
                  activeOpacity={0.85}
                >
                  <BlurView intensity={24} tint="dark" style={StyleSheet.absoluteFill} />
                  <View style={styles.scanPlaceholderInner}>
                    <Text style={styles.scanPlaceholderIcon}>{pages.length === 0 ? "📷" : "➕"}</Text>
                    <Text style={styles.scanPlaceholderText}>
                      {pages.length === 0
                        ? "Tap to Add Page 1"
                        : `Add Page ${pages.length + 1} (${pages.length}/20)`}
                    </Text>
                  </View>
                </TouchableOpacity>

                {pages.length > 0 && (
                  <>
                    <Text style={styles.label}>Note for office (optional)</Text>
                    <TextInput
                      style={[styles.input, styles.noteInput]}
                      placeholder="e.g. Paid half in cash, balance pending…"
                      placeholderTextColor="#64748B"
                      value={note}
                      onChangeText={setNote}
                      multiline
                      maxLength={500}
                    />
                    <PrimaryButton
                      title={`Upload ${pages.length} Page${pages.length === 1 ? "" : "s"} as PDF`}
                      onPress={handleUploadAndConfirm}
                      disabled={loading || uploading}
                      loading={loading}
                      loadingText={statusMessage || "Uploading..."}
                    />
                  </>
                )}
              </GlassCard>
            )}

            {/* Screen 3: Instant Upload Success */}
            {screen === "success" && (
              <GlassCard style={styles.successCard}>
                <LinearGradient
                  colors={["rgba(52,211,153,0.9)", "rgba(16,185,129,0.9)"]}
                  style={styles.successOrb}
                >
                  <Text style={styles.successGlyph}>✓</Text>
                </LinearGradient>
                <Text style={styles.successTitle}>Uploaded ✓</Text>
                <Text style={styles.successDescription}>
                  Securely saved and queued for automatic OCR. You don&apos;t have to wait!
                </Text>

                <PrimaryButton
                  title="Scan Another Invoice"
                  onPress={() => {
                    setPages([]);
                    setNote("");
                    setScreen("scan");
                  }}
                />
                <GlassButton title="📜 View My History" onPress={handleLoadHistory} />
              </GlassCard>
            )}

            {/* Screen 4: My History (own uploads + status timelines) */}
            {screen === "history" && (
              <GlassCard>
                <Text style={styles.cardTitle}>My History</Text>
                <Text style={styles.instruction}>
                  {history.length === 0
                    ? "No uploads yet. Scan your first invoice to see it here."
                    : `${history.length} upload${history.length === 1 ? "" : "s"} — tap one for its timeline.`}
                </Text>

                {history.map((inv) => {
                  const expanded = expandedId === inv.id;
                  return (
                    <TouchableOpacity
                      key={inv.id}
                      activeOpacity={0.9}
                      onPress={() => setExpandedId(expanded ? null : inv.id)}
                      style={[styles.historyItem, expanded && styles.historyItemActive]}
                    >
                      <View style={styles.historyRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.historyVendor}>
                            {inv.ocrData?.vendor || "Processing…"}
                          </Text>
                          <Text style={styles.historyMeta}>
                            {new Date(inv.createdAt).toLocaleDateString()}
                            {inv.outlet ? ` • ${inv.outlet.name}` : ""}
                            {inv.ocrData?.amount ? ` • $${inv.ocrData.amount}` : ""}
                            {inv.ocrData?.invoiceNo ? ` • ${inv.ocrData.invoiceNo}` : ""}
                          </Text>
                        </View>
                        <StatusPill status={inv.status} />
                      </View>
                      {expanded && (
                        <View style={styles.timeline}>
                          {inv.statusLogs.length === 0 ? (
                            <Text style={styles.timelineNote}>No status events yet.</Text>
                          ) : (
                            inv.statusLogs.map((log, i) => (
                              <View key={`${inv.id}-${i}`} style={styles.timelineRow}>
                                <LinearGradient
                                  colors={["#FBBF24", "#F97316"]}
                                  style={styles.timelineDot}
                                />
                                <View style={{ flex: 1 }}>
                                  <Text style={styles.timelineStatus}>{log.status}</Text>
                                  <Text style={styles.timelineNote}>
                                    {new Date(log.timestamp).toLocaleString()}
                                    {log.note ? ` — ${log.note}` : ""}
                                  </Text>
                                </View>
                              </View>
                            ))
                          )}
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}

                <View style={styles.historyActions}>
                  <View style={{ flex: 1 }}>
                    <GlassButton title="← Scan" onPress={() => setScreen("scan")} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <GlassButton
                      title="Refresh"
                      onPress={handleLoadHistory}
                      disabled={historyLoading}
                      loading={historyLoading}
                    />
                  </View>
                </View>
              </GlassCard>
            )}
          </ScrollView>
        </SafeAreaView>
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#060A18",
  },
  blob: {
    position: "absolute",
    borderRadius: 999,
  },
  safe: {
    flex: 1,
  },
  scroll: {
    padding: 20,
    alignItems: "center",
    paddingBottom: 40,
  },
  header: {
    marginVertical: 12,
    alignItems: "center",
    width: "100%",
    maxWidth: 420,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  brandLogo: {
    width: 92,
    height: 46,
    borderRadius: 10,
    backgroundColor: "#FFFFFF",
  },
  title: {
    fontSize: 26,
    fontWeight: "800",
    color: "#F8FAFC",
    letterSpacing: 0.3,
  },
  subtitle: {
    fontSize: 12,
    color: "#94A3B8",
    marginTop: 2,
  },
  serverBadgeOuter: {
    borderRadius: 20,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    marginTop: 12,
  },
  serverBadgeInner: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#34D399",
  },
  serverBadgeText: {
    fontSize: 11,
    color: "#CBD5E1",
    fontWeight: "500",
  },
  serverCard: {
    width: "100%",
    maxWidth: 420,
    marginBottom: 14,
  },
  /* Glass container (GlassEffectContainer analog): shared frosted surface */
  segmentOuter: {
    borderRadius: 22,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    marginBottom: 14,
    width: "100%",
    maxWidth: 420,
  },
  segmentInner: {
    flexDirection: "row",
    padding: 5,
    gap: 5,
  },
  segmentTab: {
    flex: 1,
  },
  segmentActive: {
    borderRadius: 17,
    paddingVertical: 10,
    alignItems: "center",
  },
  segmentActiveText: {
    color: "#1C0A00",
    fontSize: 14,
    fontWeight: "800",
  },
  segmentIdle: {
    borderRadius: 17,
    paddingVertical: 10,
    alignItems: "center",
  },
  segmentIdleText: {
    color: "#94A3B8",
    fontSize: 14,
    fontWeight: "600",
  },
  /* Frosted glass card */
  glassOuter: {
    borderRadius: 28,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    backgroundColor: "rgba(255,255,255,0.06)",
    width: "100%",
    maxWidth: 420,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
    elevation: 10,
  },
  glassInner: {
    padding: 22,
  },
  loginGlow: {
    alignItems: "center",
    marginBottom: 10,
  },
  loginLogo: {
    width: 200,
    height: 100,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#F8FAFC",
    marginBottom: 8,
    textAlign: "center",
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: "#CBD5E1",
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    marginBottom: 12,
    backgroundColor: "rgba(255,255,255,0.07)",
    color: "#F8FAFC",
  },
  instruction: {
    fontSize: 13,
    color: "#94A3B8",
    marginBottom: 16,
    lineHeight: 19,
    textAlign: "center",
  },
  /* Prominent gradient button */
  primaryWrap: {
    borderRadius: 18,
    marginTop: 10,
    shadowColor: "#F97316",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 14,
    elevation: 8,
  },
  primaryGradient: {
    borderRadius: 18,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: {
    color: "#1C0A00",
    fontSize: 16,
    fontWeight: "800",
  },
  primaryLoadingText: {
    color: "#1C0A00",
    fontSize: 14,
    fontWeight: "700",
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  /* Quiet glass button */
  glassBtnOuter: {
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    marginTop: 10,
  },
  glassBtnInner: {
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  glassBtnText: {
    color: "#E2E8F0",
    fontSize: 14,
    fontWeight: "700",
  },
  linkText: {
    color: "#7DD3FC",
    fontSize: 13,
    fontWeight: "600",
  },
  userBadgeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  userBadge: {
    backgroundColor: "rgba(125,211,252,0.14)",
    borderWidth: 1,
    borderColor: "rgba(125,211,252,0.35)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
  },
  userBadgeText: {
    color: "#7DD3FC",
    fontSize: 12,
    fontWeight: "700",
  },
  outletBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.45)",
    backgroundColor: "rgba(251,191,36,0.10)",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 14,
  },
  outletBarDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#FBBF24",
  },
  outletBarText: {
    flex: 1,
    color: "#FDE68A",
    fontSize: 13,
    fontWeight: "700",
  },
  outletBarChange: {
    color: "#7DD3FC",
    fontSize: 12,
    fontWeight: "700",
  },
  gateOutletRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
  },
  gateOutletRowActive: {
    borderColor: "rgba(251,191,36,0.6)",
    backgroundColor: "rgba(251,191,36,0.10)",
  },
  gateRadio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.3)",
    alignItems: "center",
    justifyContent: "center",
  },
  gateRadioActive: {
    borderColor: "#FBBF24",
  },
  gateRadioDot: {
    fontSize: 12,
    color: "#FBBF24",
  },
  gateOutletName: {
    fontSize: 16,
    fontWeight: "800",
    color: "#F8FAFC",
  },
  gateOutletHint: {
    fontSize: 12,
    color: "#94A3B8",
    marginTop: 2,
  },
  outletFixed: {
    backgroundColor: "rgba(125,211,252,0.10)",
    borderWidth: 1,
    borderColor: "rgba(125,211,252,0.3)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 14,
    alignSelf: "flex-start",
  },
  outletFixedText: {
    color: "#7DD3FC",
    fontSize: 12,
    fontWeight: "700",
  },
  pagesGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 14,
  },
  pageThumb: {
    width: 100,
    height: 132,
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    position: "relative",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  pageThumbImage: {
    width: "100%",
    height: "100%",
    resizeMode: "cover",
  },
  pageShade: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 44,
  },
  pageNumber: {
    position: "absolute",
    left: 6,
    bottom: 6,
    backgroundColor: "rgba(0,0,0,0.65)",
    color: "#fff",
    fontSize: 11,
    fontWeight: "800",
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 9,
    overflow: "hidden",
  },
  pageRemove: {
    position: "absolute",
    top: 4,
    right: 4,
    backgroundColor: "rgba(244,63,94,0.92)",
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  pageRemoveText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "800",
  },
  pageNoteBadge: {
    position: "absolute",
    right: 6,
    bottom: 6,
    fontSize: 12,
  },
  pageNotesList: {
    marginBottom: 6,
  },
  pageNoteRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 14,
    padding: 10,
    marginBottom: 8,
  },
  pageNoteThumb: {
    width: 52,
    height: 70,
    borderRadius: 8,
    resizeMode: "cover",
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  pageNoteTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: "#FBBF24",
    marginBottom: 4,
  },
  pageNoteInput: {
    minHeight: 56,
    textAlignVertical: "top",
    marginBottom: 0,
  },
  noteInput: {
    minHeight: 64,
    textAlignVertical: "top",
  },
  scanPlaceholderOuter: {
    height: 150,
    borderWidth: 1.5,
    borderColor: "rgba(125,211,252,0.45)",
    borderStyle: "dashed",
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: "rgba(125,211,252,0.06)",
    marginBottom: 6,
  },
  scanPlaceholderInner: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  scanPlaceholderIcon: {
    fontSize: 34,
    marginBottom: 8,
  },
  scanPlaceholderText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#7DD3FC",
    textAlign: "center",
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  successCard: {
    alignItems: "center",
  },
  successOrb: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
    marginTop: 8,
    shadowColor: "#34D399",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 18,
    elevation: 10,
  },
  successGlyph: {
    fontSize: 38,
    color: "#052E1B",
    fontWeight: "900",
  },
  successTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: "#F8FAFC",
    marginBottom: 8,
  },
  successDescription: {
    fontSize: 14,
    color: "#94A3B8",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 14,
  },
  historyItem: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  historyItemActive: {
    borderColor: "rgba(251,191,36,0.5)",
  },
  historyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  historyVendor: {
    fontSize: 15,
    fontWeight: "700",
    color: "#F8FAFC",
  },
  historyMeta: {
    fontSize: 12,
    color: "#94A3B8",
    marginTop: 3,
  },
  statusPill: {
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
  },
  statusPillText: {
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  timeline: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.10)",
    gap: 10,
  },
  timelineRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
  },
  timelineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 4,
  },
  timelineStatus: {
    fontSize: 12,
    fontWeight: "800",
    color: "#F8FAFC",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  timelineNote: {
    fontSize: 12,
    color: "#94A3B8",
    marginTop: 2,
  },
  historyActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 10,
  },
});

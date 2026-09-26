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
import * as WebBrowser from "expo-web-browser";
import * as ImagePicker from "expo-image-picker";
import {
  loginWithPassword,
  logout,
  getUploadUrl,
  getMyInvoices,
  getMyOutlets,
  getMyInvoiceViewUrl,
  updateMyInvoice,
  deleteMyInvoice,
  changeMyPassword,
  getTeam,
  addTeamMember,
  updateTeamMember,
  changeMyPin,
  buildInvoicePdf,
  uploadBytesToS3,
  confirmInvoiceUpload,
  setApiBaseUrl,
  getApiBaseUrl,
  loadPersistedToken,
  CATEGORY_LABELS,
} from "./src/services/api";
import type { InvoiceCategory } from "./src/services/api";

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
  category?: string | null;
  categoryDetail?: string | null;
  clientNote?: string | null;
  pageNotes?: string[] | null;
  uploadedByName?: string | null;
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

/** Server endpoint switcher — usable logged-out (login) and logged-in
 *  (account), so local <-> cloud switching never needs reinstall. */
function ServerSwitcher({
  serverUrl,
  setServerUrlState,
  showServerConfig,
  setShowServerConfig,
  onSave,
}: {
  serverUrl: string;
  setServerUrlState: (v: string) => void;
  showServerConfig: boolean;
  setShowServerConfig: (v: boolean) => void;
  onSave: () => void;
}) {
  return (
    <>
      <TouchableOpacity
        onPress={() => setShowServerConfig(!showServerConfig)}
        style={{ marginTop: 14, alignItems: "center" }}
      >
        <Text style={styles.serverToggle}>
          ⚙ Server: {getApiBaseUrl()} {showServerConfig ? "▾" : "▸"}
        </Text>
      </TouchableOpacity>
      {showServerConfig && (
        <View style={{ marginTop: 10 }}>
          <TouchableOpacity
            onPress={() => setServerUrlState("https://ac.jamicore.com")}
            style={{ marginBottom: 8 }}
          >
            <Text style={styles.serverPreset}>☁️ Use Cloud (ac.jamicore.com)</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setServerUrlState("http://192.168.1.13:3000")}
            style={{ marginBottom: 8 }}
          >
            <Text style={styles.serverPreset}>🏠 Use Local (192.168.1.13:3000)</Text>
          </TouchableOpacity>
          <TextInput
            style={styles.input}
            value={serverUrl}
            onChangeText={setServerUrlState}
            placeholder="https://ac.jamicore.com"
            placeholderTextColor="#64748B"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <GlassButton title="Save Server URL" onPress={onSave} />
        </View>
      )}
    </>
  );
}
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
  // + detail (invoice view/edit) + account (password/PIN) + team (owner only)
  const [screen, setScreen] = useState<"login" | "outlet" | "scan" | "success" | "history" | "detail" | "account" | "team">("login");
  // Admin-provided credentials (no OTP)
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [client, setClient] = useState<{
    id: string;
    name: string;
    username?: string | null;
    role?: string | null;
    clientId?: string | null;
    clientName?: string | null;
  } | null>(null);
  // Multi-page invoice (Adobe Scan style): one or more photos -> single PDF.
  // Each page carries its own note (per-snap notes, since pages differ).
  const [pages, setPages] = useState<Array<{ uri: string; note: string; rotation: 0 | 90 | 180 | 270; flipH: boolean }>>([]);
  const [note, setNote] = useState("");
  // Main upload category (default Sales Invoice; Other reveals a text box)
  const [category, setCategory] = useState<InvoiceCategory>("sales_invoice");
  const [categoryDetail, setCategoryDetail] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  // Outlets of this client (for tagging uploads). 0 = none yet, 1 = auto,
  // 2+ = client must pick one per upload.
  const [outlets, setOutlets] = useState<Array<{ id: string; name: string; address?: string | null; phone?: string | null }>>([]);
  const [selectedOutletId, setSelectedOutletId] = useState<string | null>(null);
  // History state
  const [history, setHistory] = useState<HistoryInvoice[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  // Last uploaded invoice id (for instant "View" on the success screen)
  const [lastUploadId, setLastUploadId] = useState<string | null>(null);

  /** Open the just-uploaded invoice in detail view (via fresh history). */
  const handleViewLastUpload = async () => {
    if (!lastUploadId) return;
    setHistoryLoading(true);
    try {
      const items = await getMyInvoices();
      setHistory(items);
      const found = items.find((x) => x.id === lastUploadId);
      if (found) {
        openDetail(found);
      } else {
        Alert.alert("Not ready yet", "Opening history instead.");
        setScreen("history");
      }
    } catch (err: any) {
      Alert.alert("View Failed", err.message);
    } finally {
      setHistoryLoading(false);
    }
  };
  // Detail / edit state
  const [selected, setSelected] = useState<HistoryInvoice | null>(null);
  const [editing, setEditing] = useState(false);
  const [editNote, setEditNote] = useState("");
  const [editPageNotes, setEditPageNotes] = useState<string[]>([]);
  const [editOutletId, setEditOutletId] = useState<string | null>(null);
  const [editCategory, setEditCategory] = useState<InvoiceCategory>("sales_invoice");
  const [editCategoryDetail, setEditCategoryDetail] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [viewUrl, setViewUrl] = useState<string | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  // Account state
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  // Team state (owner only)
  const [team, setTeam] = useState<Array<{ id: string; name: string; username: string; isActive: boolean; createdAt: string }>>([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const [tmName, setTmName] = useState("");
  const [tmUsername, setTmUsername] = useState("");
  const [tmPin, setTmPin] = useState("");
  const [resetPinId, setResetPinId] = useState<string | null>(null);
  const [resetPin, setResetPin] = useState("");
  const [teamMsg, setTeamMsg] = useState<string | null>(null);

  const isOwner = client?.role !== "client_staff";
  const displayName = client?.role === "client_staff" && client?.clientName
    ? `${client.name} (${client.clientName})`
    : client?.name;

  /** Client-editable while the office hasn't taken it. Mirrors server rule. */
  const isEditable = (status: string) =>
    ["uploaded", "ocr_pending", "ocr_done", "ocr_failed"].includes(status);

  const counts = {
    total: history.length,
    active: history.filter((h) => !["collected", "disputed"].includes(h.status)).length,
    done: history.filter((h) => ["collected", "disputed"].includes(h.status)).length,
  };

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
      // Silent history preload for My-counts chips (ignore failures)
      getMyInvoices().then(setHistory).catch(() => undefined);
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
    setCategory("sales_invoice");
    setCategoryDetail("");
    setOutlets([]);
    setSelectedOutletId(null);
    setHistory([]);
    setSelected(null);
    setEditing(false);
    setViewUrl(null);
    setLastUploadId(null);
    setOldPw("");
    setNewPw("");
    setConfirmPw("");
    setPwMsg(null);
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

  // 2b. Open invoice detail (viewer + edit + withdraw)
  const openDetail = (inv: HistoryInvoice) => {
    setSelected(inv);
    setEditing(false);
    setViewUrl(null);
    setScreen("detail");
  };

  const refreshSelected = async (id: string) => {
    try {
      const items = await getMyInvoices();
      setHistory(items);
      const fresh = items.find((x) => x.id === id) || null;
      setSelected(fresh);
      if (!fresh) setScreen("history");
    } catch {
      // keep stale view on refresh failure
    }
  };

  // 2c. View document: images inline, PDFs in system browser viewer
  const handleViewDocument = async () => {
    if (!selected) return;
    setViewLoading(true);
    try {
      const info = await getMyInvoiceViewUrl(selected.id);
      if (info.isPdf) {
        await WebBrowser.openBrowserAsync(info.url);
      } else {
        setViewUrl(info.url);
      }
    } catch (err: any) {
      Alert.alert("View Failed", err.message);
    } finally {
      setViewLoading(false);
    }
  };

  // 2d. Edit my invoice (notes/outlet/category) — server enforces pre-assignment rule
  const handleStartEdit = () => {
    if (!selected) return;
    setEditNote(selected.clientNote || "");
    const n = selected.pageNotes || [];
    setEditPageNotes(n);
    setEditOutletId(selected.outlet?.id || null);
    setEditCategory((selected.category as InvoiceCategory) || "sales_invoice");
    setEditCategoryDetail(selected.categoryDetail || "");
    setEditing(true);
  };

  const handleSaveEdit = async () => {
    if (!selected) return;
    if (editCategory === "other" && !editCategoryDetail.trim()) {
      Alert.alert("Category Required", "Please describe the custom category for Other.");
      return;
    }
    setSavingEdit(true);
    try {
      await updateMyInvoice(selected.id, {
        note: editNote,
        pageNotes: editPageNotes,
        outletId: editOutletId,
        category: editCategory,
        categoryDetail: editCategory === "other" ? editCategoryDetail.trim() : null,
      });
      setEditing(false);
      Alert.alert("Saved", "Invoice updated.");
      await refreshSelected(selected.id);
    } catch (err: any) {
      Alert.alert("Save Failed", err.message);
    } finally {
      setSavingEdit(false);
    }
  };

  // 2e. Withdraw my upload (server enforces pre-assignment rule)
  const handleDeleteInvoice = () => {
    if (!selected) return;
    Alert.alert(
      "Withdraw Invoice?",
      "This deletes the upload and its file. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Withdraw",
          style: "destructive",
          onPress: async () => {
            setSavingEdit(true);
            try {
              const res = await deleteMyInvoice(selected.id);
              Alert.alert("Withdrawn", res.message || "Invoice withdrawn.");
              setSelected(null);
              await handleLoadHistory();
            } catch (err: any) {
              Alert.alert("Withdraw Failed", err.message);
            } finally {
              setSavingEdit(false);
            }
          },
        },
      ]
    );
  };

  // 2f. Change my login password
  const handleChangePassword = async () => {
    if (!oldPw || !newPw || !confirmPw) {
      setPwMsg("Fill all three fields.");
      return;
    }
    if (newPw !== confirmPw) {
      setPwMsg(isOwner ? "New passwords do not match." : "New PINs do not match.");
      return;
    }
    if (isOwner ? newPw.length < 8 : !/^\d{4,6}$/.test(newPw)) {
      setPwMsg(isOwner ? "New password must be at least 8 characters." : "New PIN must be 4-6 digits.");
      return;
    }
    setSavingEdit(true);
    setPwMsg(null);
    try {
      if (isOwner) {
        await changeMyPassword(oldPw, newPw);
        setPwMsg("Password changed successfully.");
      } else {
        await changeMyPin(oldPw, newPw);
        setPwMsg("PIN changed successfully.");
      }
      setOldPw("");
      setNewPw("");
      setConfirmPw("");
    } catch (err: any) {
      setPwMsg(err.message);
    } finally {
      setSavingEdit(false);
    }
  };

  // Team management (owner only)
  const handleLoadTeam = async () => {
    setTeamLoading(true);
    setTeamMsg(null);
    try {
      const members = await getTeam();
      setTeam(members);
      setScreen("team");
    } catch (err: any) {
      Alert.alert("Team Failed", err.message);
    } finally {
      setTeamLoading(false);
    }
  };

  const handleAddMember = async () => {
    if (!tmName.trim() || !tmUsername.trim() || !tmPin.trim()) {
      setTeamMsg("Name, user ID and PIN are all required.");
      return;
    }
    if (!/^\d{4,6}$/.test(tmPin.trim())) {
      setTeamMsg("PIN must be 4-6 digits.");
      return;
    }
    setSavingEdit(true);
    setTeamMsg(null);
    try {
      const res = await addTeamMember(tmName.trim(), tmUsername.trim(), tmPin.trim());
      setTmName("");
      setTmUsername("");
      setTmPin("");
      setTeamMsg(res.message || "Team member added.");
      const members = await getTeam();
      setTeam(members);
    } catch (err: any) {
      setTeamMsg(err.message);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleResetMemberPin = async (id: string) => {
    if (!/^\d{4,6}$/.test(resetPin.trim())) {
      setTeamMsg("New PIN must be 4-6 digits.");
      return;
    }
    setSavingEdit(true);
    setTeamMsg(null);
    try {
      await updateTeamMember(id, { pin: resetPin.trim() });
      setResetPinId(null);
      setResetPin("");
      setTeamMsg("PIN reset. Share the new PIN with the member.");
      const members = await getTeam();
      setTeam(members);
    } catch (err: any) {
      setTeamMsg(err.message);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleToggleMember = async (id: string, active: boolean) => {
    setSavingEdit(true);
    setTeamMsg(null);
    try {
      await updateTeamMember(id, { isActive: active });
      const members = await getTeam();
      setTeam(members);
    } catch (err: any) {
      setTeamMsg(err.message);
    } finally {
      setSavingEdit(false);
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
          setPages((prev) => [...prev, { uri: scannedImages[0], note: "", rotation: 0 as const, flipH: false }].slice(0, 20));
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
                setPages((prev) => [...prev, { uri: result.assets[0].uri, note: "", rotation: 0 as const, flipH: false }].slice(0, 20));
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
                setPages((prev) => [...prev, { uri: result.assets[0].uri, note: "", rotation: 0 as const, flipH: false }].slice(0, 20));
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

  /** Rotate 90° clockwise (stored as intent, applied losslessly at PDF build). */
  const handleRotatePage = (index: number) => {
    setPages((prev) =>
      prev.map((p, i) =>
        i === index ? { ...p, rotation: ((p.rotation + 90) % 360) as 0 | 90 | 180 | 270 } : p
      )
    );
  };

  /** Mirror horizontally (stored as intent, applied at PDF build). */
  const handleFlipPage = (index: number) => {
    setPages((prev) => prev.map((p, i) => (i === index ? { ...p, flipH: !p.flipH } : p)));
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
    if (category === "other" && !categoryDetail.trim()) {
      Alert.alert("Category Required", "Please describe the custom category for Other.");
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
      // 4. Confirm upload (overall note + per-page notes + outlet + category)
      const confirmed = await confirmInvoiceUpload(
        s3Key,
        note,
        pages.map((p) => p.note),
        selectedOutletId ?? undefined,
        category,
        category === "other" ? categoryDetail.trim() : undefined
      );

      // 5. Fire-and-forget confirmation
      setStatusMessage("");
      setPages([]);
      setNote("");
      setCategory("sales_invoice");
      setCategoryDetail("");
      setLastUploadId(confirmed?.invoice?.id ?? null);
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
            </View>

            {/* Segmented Scan | History | Team control (glass container).
                Team tab is owner-only (staff logins don't see it). */}
            {loggedIn && (screen === "scan" || screen === "history" || screen === "team") && (
              <View style={styles.segmentOuter}>
                <BlurView intensity={36} tint="dark" style={StyleSheet.absoluteFill} />
                <View style={styles.segmentInner}>
                  {(isOwner ? (["scan", "history", "team"] as const) : (["scan", "history"] as const)).map((tab) => {
                    const active = screen === tab;
                    const label = tab === "scan" ? "◉  Scan" : tab === "history" ? "◔  History" : "👥  Team";
                    const go = () => {
                      if (tab === "history") handleLoadHistory();
                      else if (tab === "team") handleLoadTeam();
                      else setScreen("scan");
                    };
                    return (
                      <TouchableOpacity
                        key={tab}
                        onPress={go}
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
                              {label}
                            </Text>
                          </LinearGradient>
                        ) : (
                          <View style={styles.segmentIdle}>
                            <Text style={styles.segmentIdleText}>
                              {label}
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
                  Sign in with your user ID and password (shop staff: user ID + PIN).
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

                <Text style={styles.label}>Password / PIN</Text>
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
                <ServerSwitcher
                  serverUrl={serverUrl}
                  setServerUrlState={setServerUrlState}
                  showServerConfig={showServerConfig}
                  setShowServerConfig={setShowServerConfig}
                  onSave={handleUpdateServerUrl}
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
                <Text style={styles.userBadgeText}>◍ {displayName}</Text>
              </View>
              <View style={styles.userBadgeActions}>
                <TouchableOpacity onPress={() => { setPwMsg(null); setScreen("account"); }}>
                  <Text style={styles.linkText}>👤 Account</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleLogout}>
                  <Text style={styles.linkText}>Log out</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* My counts */}
            <View style={styles.countsRow}>
              <View style={styles.countChip}>
                <Text style={styles.countNum}>{counts.total}</Text>
                <Text style={styles.countLabel}>Uploads</Text>
              </View>
              <View style={styles.countChip}>
                <Text style={[styles.countNum, { color: "#FCD34D" }]}>{counts.active}</Text>
                <Text style={styles.countLabel}>In Progress</Text>
              </View>
              <View style={styles.countChip}>
                <Text style={[styles.countNum, { color: "#6EE7B7" }]}>{counts.done}</Text>
                <Text style={styles.countLabel}>Done</Text>
              </View>
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
                    {pages.map((page, i) => {
                      // Live preview of pending edits (same math as PDF build):
                      // rotate, fit inside the frame when sideways, mirror.
                      const previewTransform: Array<{ rotate: string } | { scale: number } | { scaleX: number }> = [];
                      if (page.flipH) previewTransform.push({ scaleX: -1 });
                      if (page.rotation) {
                        previewTransform.push({ rotate: `${page.rotation}deg` });
                        if (page.rotation % 180 !== 0) previewTransform.push({ scale: 0.75 });
                      }
                      return (
                      <View
                        key={`${i}-${page.uri}`}
                        style={styles.pageThumb}
                      >
                        <Image
                          source={{ uri: page.uri }}
                          style={[styles.pageThumbImage, previewTransform.length > 0 && { transform: previewTransform }]}
                        />
                        <LinearGradient
                          colors={["transparent", "rgba(0,0,0,0.55)"]}
                          style={styles.pageShade}
                        />
                        <Text style={styles.pageNumber}>{i + 1}</Text>
                        {page.note.trim() ? <Text style={styles.pageNoteBadge}>📝</Text> : null}
                        {(page.rotation !== 0 || page.flipH) && (
                          <Text style={styles.pageEditBadge}>
                            {page.rotation ? `${page.rotation}°` : ""}{page.rotation && page.flipH ? " " : ""}{page.flipH ? "⇋" : ""}
                          </Text>
                        )}
                        <View style={styles.pageTools}>
                          <TouchableOpacity
                            style={styles.pageTool}
                            onPress={() => handleRotatePage(i)}
                          >
                            <Text style={styles.pageToolText}>⟳</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.pageTool, page.flipH && styles.pageToolActive]}
                            onPress={() => handleFlipPage(i)}
                          >
                            <Text style={styles.pageToolText}>⇋</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.pageTool, styles.pageToolDanger]}
                            onPress={() => handleRemovePage(i)}
                          >
                            <Text style={styles.pageToolText}>✕</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                      );
                    })}
                  </View>
                )}

                {pages.length > 0 && (
                  <View style={styles.pageNotesList}>
                    <Text style={styles.label}>Notes — one per page</Text>
                    {pages.map((page, i) => {
                      const miniTransform: Array<{ rotate: string } | { scale: number } | { scaleX: number }> = [];
                      if (page.flipH) miniTransform.push({ scaleX: -1 });
                      if (page.rotation) {
                        miniTransform.push({ rotate: `${page.rotation}deg` });
                        if (page.rotation % 180 !== 0) miniTransform.push({ scale: 0.75 });
                      }
                      return (
                        <View key={`note-${i}-${page.uri}`} style={styles.pageNoteRow}>
                          <Image
                            source={{ uri: page.uri }}
                            style={[styles.pageNoteThumb, miniTransform.length > 0 && { transform: miniTransform }]}
                          />
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
                      );
                    })}
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
                    <Text style={styles.label}>Category *</Text>
                    <View style={styles.catChips}>
                      {(Object.keys(CATEGORY_LABELS) as Array<keyof typeof CATEGORY_LABELS>).map((c) => {
                        const active = category === c;
                        return (
                          <TouchableOpacity
                            key={c}
                            onPress={() => setCategory(c)}
                            activeOpacity={0.85}
                            style={[styles.catChip, active && styles.catChipActive]}
                          >
                            <Text style={[styles.catChipText, active && styles.catChipTextActive]}>
                              {CATEGORY_LABELS[c]}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    {category === "other" && (
                      <>
                        <Text style={styles.label}>Describe the category *</Text>
                        <TextInput
                          style={styles.input}
                          placeholder="e.g. Delivery Challan"
                          placeholderTextColor="#64748B"
                          value={categoryDetail}
                          onChangeText={(t) => setCategoryDetail(t.slice(0, 200))}
                          maxLength={200}
                        />
                      </>
                    )}
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
                  Securely saved and sent to the office. You don&apos;t have to wait!
                </Text>

                <PrimaryButton
                  title="Scan Another Invoice"
                  onPress={() => {
                    setPages([]);
                    setNote("");
                    setCategory("sales_invoice");
                    setCategoryDetail("");
                    setLastUploadId(null);
                    setScreen("scan");
                  }}
                />
                {lastUploadId && (
                  <GlassButton
                    title="👁 View Upload"
                    onPress={handleViewLastUpload}
                    disabled={historyLoading}
                    loading={historyLoading}
                  />
                )}
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
                    : `${history.length} upload${history.length === 1 ? "" : "s"} — tap one to view, edit or withdraw it.`}
                </Text>

                {history.map((inv) => (
                  <TouchableOpacity
                    key={inv.id}
                    activeOpacity={0.9}
                    onPress={() => openDetail(inv)}
                    style={styles.historyItem}
                  >
                      <View style={styles.historyRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.historyVendor}>
                            {inv.ocrData?.vendor || "Processing…"}
                          </Text>
                          <Text style={styles.historyMeta}>
                            {new Date(inv.createdAt).toLocaleDateString()}
                            {inv.outlet ? ` • ${inv.outlet.name}` : ""}
                            {inv.category ? ` • ${inv.category === "other" && inv.categoryDetail ? inv.categoryDetail : (CATEGORY_LABELS as Record<string, string>)[inv.category] || inv.category}` : ""}
                            {inv.uploadedByName ? ` • by ${inv.uploadedByName}` : ""}
                            {inv.ocrData?.amount ? ` • $${inv.ocrData.amount}` : ""}
                            {inv.ocrData?.invoiceNo ? ` • ${inv.ocrData.invoiceNo}` : ""}
                          </Text>
                        </View>
                        <StatusPill status={inv.status} />
                        <Text style={styles.historyChevron}>›</Text>
                      </View>
                  </TouchableOpacity>
                ))}

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

            {/* Screen: Invoice Detail (view document, edit, withdraw) */}
            {screen === "detail" && selected && (
              <GlassCard>
                <View style={styles.userBadgeRow}>
                  <StatusPill status={selected.status} />
                  <TouchableOpacity onPress={() => { setSelected(null); setEditing(false); setViewUrl(null); setScreen("history"); }}>
                    <Text style={styles.linkText}>← History</Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.cardTitle}>{selected.ocrData?.vendor || "Invoice"}</Text>
                <Text style={styles.instruction}>
                  {new Date(selected.createdAt).toLocaleDateString()}
                  {selected.outlet ? ` • ${selected.outlet.name}` : ""}
                  {selected.category ? ` • ${selected.category === "other" && selected.categoryDetail ? selected.categoryDetail : (CATEGORY_LABELS as Record<string, string>)[selected.category] || selected.category}` : ""}
                  {selected.ocrData?.amount ? ` • $${selected.ocrData.amount}` : ""}
                </Text>

                {!viewUrl ? (
                  <GlassButton
                    title={viewLoading ? "Loading…" : "👁 View Document"}
                    onPress={handleViewDocument}
                    disabled={viewLoading}
                    loading={viewLoading}
                  />
                ) : (
                  <View style={styles.docPreview}>
                    <Image source={{ uri: viewUrl }} style={styles.docImage} />
                    <Text style={styles.historyMeta}>Link expires in 5 minutes — reopen if expired.</Text>
                  </View>
                )}

                {!editing && (
                  <>
                    {selected.clientNote ? (
                      <View style={styles.detailNoteBox}>
                        <Text style={styles.label}>My note</Text>
                        <Text style={styles.detailNoteText}>{selected.clientNote}</Text>
                      </View>
                    ) : null}
                    {(selected.pageNotes || []).some((n) => n && n.trim()) && (
                      <View style={styles.detailNoteBox}>
                        <Text style={styles.label}>Page notes</Text>
                        {(selected.pageNotes || []).map((n, i) =>
                          n && n.trim() ? (
                            <Text key={i} style={styles.detailNoteText}>
                              p{i + 1}: {n}
                            </Text>
                          ) : null
                        )}
                      </View>
                    )}
                    <View style={styles.timeline}>
                      {selected.statusLogs.map((log, i) => (
                        <View key={`${selected.id}-${i}`} style={styles.timelineRow}>
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
                      ))}
                    </View>
                  </>
                )}

                {editing ? (
                  <View style={styles.editBox}>
                    <Text style={styles.label}>My note</Text>
                    <TextInput
                      style={[styles.input, styles.noteInput]}
                      placeholder="Note for office…"
                      placeholderTextColor="#64748B"
                      value={editNote}
                      onChangeText={setEditNote}
                      multiline
                      maxLength={500}
                    />
                    <Text style={styles.label}>Page notes</Text>
                    {Array.from({ length: Math.max(selected.pageNotes?.length || 0, 1) }).map((_, i) => (
                      <View key={i}>
                        <Text style={styles.pageNoteTitle}>Page {i + 1}</Text>
                        <TextInput
                          style={[styles.input, styles.pageNoteInput]}
                          placeholder={`Note for page ${i + 1} (optional)…`}
                          placeholderTextColor="#64748B"
                          value={editPageNotes[i] || ""}
                          onChangeText={(t) => {
                            const next = [...editPageNotes];
                            next[i] = t.slice(0, 500);
                            setEditPageNotes(next);
                          }}
                          multiline
                          maxLength={500}
                        />
                      </View>
                    ))}
                    {outlets.length > 0 && (
                      <>
                        <Text style={styles.label}>Outlet</Text>
                        <View style={styles.editOutletRow}>
                          {outlets.map((o) => (
                            <TouchableOpacity
                              key={o.id}
                              onPress={() => setEditOutletId(o.id)}
                              style={[styles.editOutletChip, editOutletId === o.id && styles.editOutletChipActive]}
                            >
                              <Text style={[styles.editOutletChipText, editOutletId === o.id && styles.editOutletChipTextActive]}>
                                {o.name}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </>
                    )}
                    <Text style={styles.label}>Category</Text>
                    <View style={styles.editOutletRow}>
                      {(Object.keys(CATEGORY_LABELS) as InvoiceCategory[]).map((c) => (
                        <TouchableOpacity
                          key={c}
                          onPress={() => setEditCategory(c)}
                          style={[styles.editOutletChip, editCategory === c && styles.editOutletChipActive]}
                        >
                          <Text style={[styles.editOutletChipText, editCategory === c && styles.editOutletChipTextActive]}>
                            {CATEGORY_LABELS[c]}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    {editCategory === "other" && (
                      <TextInput
                        style={styles.input}
                        placeholder="Describe the category *"
                        placeholderTextColor="#64748B"
                        value={editCategoryDetail}
                        onChangeText={(t) => setEditCategoryDetail(t.slice(0, 200))}
                        maxLength={200}
                      />
                    )}
                    <PrimaryButton
                      title="Save Changes"
                      onPress={handleSaveEdit}
                      disabled={savingEdit}
                      loading={savingEdit}
                      loadingText="Saving..."
                    />
                    <GlassButton title="Cancel" onPress={() => setEditing(false)} />
                  </View>
                ) : (
                  isEditable(selected.status) && (
                    <View style={styles.detailActions}>
                      <View style={{ flex: 1 }}>
                        <GlassButton title="✏️ Edit" onPress={handleStartEdit} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <GlassButton title="🗑 Withdraw" onPress={handleDeleteInvoice} />
                      </View>
                    </View>
                  )
                )}
                {!isEditable(selected.status) && !editing && (
                  <Text style={styles.lockNote}>
                    🔒 With the office (status: {selected.status}) — contact them for changes.
                  </Text>
                )}
              </GlassCard>
            )}

            {/* Screen: Account (owner password / staff PIN) */}
            {screen === "account" && (
              <GlassCard>
                <Text style={styles.cardTitle}>👤 Account</Text>
                <Text style={styles.instruction}>
                  Signed in as {displayName}. Change your {isOwner ? "login password" : "login PIN"} below.
                </Text>
                {pwMsg && (
                  <View style={styles.pwMsgBox}>
                    <Text style={styles.pwMsgText}>{pwMsg}</Text>
                  </View>
                )}
                <Text style={styles.label}>Current {isOwner ? "password" : "PIN"}</Text>
                <TextInput
                  style={styles.input}
                  placeholder="••••••••"
                  placeholderTextColor="#64748B"
                  value={oldPw}
                  onChangeText={setOldPw}
                  secureTextEntry
                  autoCapitalize="none"
                  keyboardType={isOwner ? "default" : "number-pad"}
                />
                <Text style={styles.label}>{isOwner ? "New password (min 8)" : "New PIN (4-6 digits)"}</Text>
                <TextInput
                  style={styles.input}
                  placeholder="••••••••"
                  placeholderTextColor="#64748B"
                  value={newPw}
                  onChangeText={setNewPw}
                  secureTextEntry
                  autoCapitalize="none"
                  keyboardType={isOwner ? "default" : "number-pad"}
                />
                <Text style={styles.label}>Confirm {isOwner ? "new password" : "new PIN"}</Text>
                <TextInput
                  style={styles.input}
                  placeholder="••••••••"
                  placeholderTextColor="#64748B"
                  value={confirmPw}
                  onChangeText={setConfirmPw}
                  secureTextEntry
                  autoCapitalize="none"
                  keyboardType={isOwner ? "default" : "number-pad"}
                />
                <PrimaryButton
                  title={isOwner ? "Change Password" : "Change PIN"}
                  onPress={handleChangePassword}
                  disabled={savingEdit}
                  loading={savingEdit}
                  loadingText="Saving..."
                />
                <ServerSwitcher
                  serverUrl={serverUrl}
                  setServerUrlState={setServerUrlState}
                  showServerConfig={showServerConfig}
                  setShowServerConfig={setShowServerConfig}
                  onSave={handleUpdateServerUrl}
                />
                <GlassButton title="← Back to Scan" onPress={() => setScreen("scan")} />
              </GlassCard>
            )}

            {/* Screen: Team (owner only — create staff + PINs, reset, activate) */}
            {screen === "team" && (
              <GlassCard>
                <Text style={styles.cardTitle}>👥 My Team</Text>
                <Text style={styles.instruction}>
                  Shop staff sign in with their user ID + PIN and upload for {client?.name}.
                </Text>
                {teamMsg && (
                  <View style={styles.pwMsgBox}>
                    <Text style={styles.pwMsgText}>{teamMsg}</Text>
                  </View>
                )}

                {/* Our branches — which shops this team's uploads can tag */}
                <View style={styles.branchesBox}>
                  <Text style={styles.label}>🏪 Our Branches ({outlets.length})</Text>
                  {outlets.length === 0 ? (
                    <Text style={styles.branchesEmpty}>
                      No branches yet — ask the office to add outlets for upload tagging.
                    </Text>
                  ) : (
                    outlets.map((o) => (
                      <View key={o.id} style={styles.branchRowBox}>
                        <Text style={styles.branchRow}>◍ {o.name}</Text>
                        {[o.address, o.phone].filter(Boolean).length > 0 && (
                          <Text style={styles.branchSub}>
                            {[o.address, o.phone].filter(Boolean).join(" • ")}
                          </Text>
                        )}
                      </View>
                    ))
                  )}
                </View>

                {team.length === 0 && !teamLoading ? (
                  <Text style={styles.instruction}>No team members yet — add the first below.</Text>
                ) : (
                  team.map((m) => (
                    <View key={m.id} style={styles.teamRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.teamName}>
                          {m.name} {!m.isActive && <Text style={styles.teamOff}>(off)</Text>}
                        </Text>
                        <Text style={styles.historyMeta}>@{m.username}</Text>
                        {resetPinId === m.id ? (
                          <View style={styles.teamResetRow}>
                            <TextInput
                              style={[styles.input, styles.teamPinInput]}
                              placeholder="New 4-6 digit PIN"
                              placeholderTextColor="#64748B"
                              value={resetPin}
                              onChangeText={setResetPin}
                              keyboardType="number-pad"
                              maxLength={6}
                              secureTextEntry
                            />
                            <TouchableOpacity
                              style={styles.teamMiniBtn}
                              onPress={() => handleResetMemberPin(m.id)}
                              disabled={savingEdit}
                            >
                              <Text style={styles.teamMiniBtnText}>Save</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={styles.teamMiniBtnGhost}
                              onPress={() => { setResetPinId(null); setResetPin(""); }}
                            >
                              <Text style={styles.teamMiniBtnGhostText}>✕</Text>
                            </TouchableOpacity>
                          </View>
                        ) : (
                          <View style={styles.teamResetRow}>
                            <TouchableOpacity
                              style={styles.teamMiniBtnGhost}
                              onPress={() => { setResetPinId(m.id); setResetPin(""); setTeamMsg(null); }}
                            >
                              <Text style={styles.teamMiniBtnGhostText}>Reset PIN</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={styles.teamMiniBtnGhost}
                              onPress={() => handleToggleMember(m.id, !m.isActive)}
                              disabled={savingEdit}
                            >
                              <Text style={styles.teamMiniBtnGhostText}>
                                {m.isActive ? "Deactivate" : "Activate"}
                              </Text>
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                      <View style={[styles.teamDot, m.isActive ? styles.teamDotOn : styles.teamDotOff]} />
                    </View>
                  ))
                )}

                <Text style={[styles.label, { marginTop: 12 }]}>Add team member</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Full name"
                  placeholderTextColor="#64748B"
                  value={tmName}
                  onChangeText={setTmName}
                />
                <View style={styles.teamFormRow}>
                  <TextInput
                    style={[styles.input, { flex: 1 }]}
                    placeholder="user.id"
                    placeholderTextColor="#64748B"
                    value={tmUsername}
                    onChangeText={setTmUsername}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <TextInput
                    style={[styles.input, { flex: 1 }]}
                    placeholder="4-6 digit PIN"
                    placeholderTextColor="#64748B"
                    value={tmPin}
                    onChangeText={setTmPin}
                    keyboardType="number-pad"
                    maxLength={6}
                    secureTextEntry
                  />
                </View>
                <PrimaryButton
                  title="Add Member"
                  onPress={handleAddMember}
                  disabled={savingEdit}
                  loading={savingEdit}
                  loadingText="Adding..."
                />
                <GlassButton title="← Back to Scan" onPress={() => setScreen("scan")} />
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
    backgroundColor: "#000000",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
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
  serverToggle: {
    fontSize: 12,
    color: "#64748B",
    fontWeight: "600",
  },
  serverPreset: {
    fontSize: 13,
    color: "#7DD3FC",
    fontWeight: "700",
    textAlign: "center",
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
    backgroundColor: "#000000",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
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
    marginBottom: 12,
  },
  userBadgeActions: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
  },
  countsRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 14,
  },
  countChip: {
    flex: 1,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 14,
    paddingVertical: 10,
    alignItems: "center",
  },
  countNum: {
    fontSize: 20,
    fontWeight: "800",
    color: "#F8FAFC",
  },
  countLabel: {
    fontSize: 10,
    color: "#94A3B8",
    marginTop: 2,
    textTransform: "uppercase",
    letterSpacing: 0.5,
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
  pageNoteBadge: {
    position: "absolute",
    right: 6,
    bottom: 6,
    fontSize: 12,
  },
  pageEditBadge: {
    position: "absolute",
    left: 6,
    top: 6,
    backgroundColor: "rgba(37,99,235,0.9)",
    color: "#fff",
    fontSize: 10,
    fontWeight: "800",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    overflow: "hidden",
  },
  pageTools: {
    position: "absolute",
    top: 4,
    right: 4,
    flexDirection: "row",
    gap: 4,
  },
  pageTool: {
    backgroundColor: "rgba(15,23,42,0.8)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  pageToolActive: {
    backgroundColor: "rgba(37,99,235,0.9)",
    borderColor: "rgba(147,197,253,0.7)",
  },
  pageToolDanger: {
    backgroundColor: "rgba(220,38,38,0.9)",
    borderColor: "rgba(252,165,165,0.6)",
  },
  pageToolText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "800",
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
  catChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },
  catChip: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(255,255,255,0.06)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
  },
  catChipActive: {
    backgroundColor: "rgba(52,211,153,0.9)",
    borderColor: "rgba(52,211,153,0.9)",
  },
  catChipText: {
    color: "#CBD5E1",
    fontSize: 12,
    fontWeight: "700",
  },
  catChipTextActive: {
    color: "#052E1B",
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
  historyChevron: {
    fontSize: 22,
    color: "#64748B",
    fontWeight: "700",
  },
  docPreview: {
    borderRadius: 14,
    overflow: "hidden",
    marginBottom: 12,
  },
  docImage: {
    width: "100%",
    height: 320,
    resizeMode: "contain",
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 14,
  },
  detailNoteBox: {
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.35)",
    backgroundColor: "rgba(251,191,36,0.08)",
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
  },
  detailNoteText: {
    fontSize: 13,
    color: "#FDE68A",
    marginTop: 2,
  },
  editBox: {
    marginTop: 4,
  },
  detailActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 10,
  },
  lockNote: {
    fontSize: 12,
    color: "#94A3B8",
    textAlign: "center",
    marginTop: 12,
  },
  editOutletRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 6,
  },
  editOutletChip: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(255,255,255,0.06)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
  },
  editOutletChipActive: {
    backgroundColor: "rgba(251,191,36,0.9)",
    borderColor: "rgba(251,191,36,0.9)",
  },
  editOutletChipText: {
    color: "#CBD5E1",
    fontSize: 12,
    fontWeight: "700",
  },
  editOutletChipTextActive: {
    color: "#1C0A00",
  },
  pwMsgBox: {
    borderWidth: 1,
    borderColor: "rgba(125,211,252,0.35)",
    backgroundColor: "rgba(125,211,252,0.10)",
    borderRadius: 12,
    padding: 10,
    marginBottom: 12,
  },
  pwMsgText: {
    fontSize: 13,
    color: "#7DD3FC",
    textAlign: "center",
  },
  teamRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
  },
  teamName: {
    fontSize: 15,
    fontWeight: "800",
    color: "#F8FAFC",
  },
  teamOff: {
    fontSize: 11,
    color: "#FCA5A5",
  },
  teamDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  teamDotOn: {
    backgroundColor: "#34D399",
  },
  teamDotOff: {
    backgroundColor: "#64748B",
  },
  teamResetRow: {
    flexDirection: "row",
    gap: 6,
    marginTop: 8,
    alignItems: "center",
  },
  teamPinInput: {
    flex: 1,
    marginBottom: 0,
  },
  teamMiniBtn: {
    backgroundColor: "rgba(251,191,36,0.9)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  teamMiniBtnText: {
    color: "#1C0A00",
    fontSize: 12,
    fontWeight: "800",
  },
  teamMiniBtnGhost: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  teamMiniBtnGhostText: {
    color: "#CBD5E1",
    fontSize: 12,
    fontWeight: "700",
  },
  teamFormRow: {
    flexDirection: "row",
    gap: 8,
  },
  branchesBox: {
    borderWidth: 1,
    borderColor: "rgba(125,211,252,0.3)",
    backgroundColor: "rgba(125,211,252,0.07)",
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
  },
  branchesEmpty: {
    fontSize: 12,
    color: "#94A3B8",
  },
  branchRowBox: {
    marginTop: 6,
  },
  branchRow: {
    fontSize: 14,
    fontWeight: "700",
    color: "#F8FAFC",
  },
  branchSub: {
    fontSize: 12,
    color: "#94A3B8",
    marginTop: 1,
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

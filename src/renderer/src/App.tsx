import { useState, useEffect, useRef } from "react";
import {
  Download,
  Trash2,
  Terminal,
  Copy,
  Check,
  Cpu,
  ShieldCheck,
  Search,
  Sun,
  Moon,
} from "lucide-react";

interface Software {
  id: string;
  name: string;
  category: string;
  size?: string;
  description: string;
  platforms: any;
}

interface LogLine {
  id?: string;
  text: string;
  type?: "info" | "error" | "success" | "warning";
  timestamp: string;
  replace?: boolean;
}

function App() {
  const [software, setSoftware] = useState<Software[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [processing, setProcessing] = useState<Set<string>>(new Set());
  const [inventory, setInventory] = useState<Record<string, boolean>>({});
  const [logs, setLogs] = useState<LogLine[]>([]);
  // Initial width 280, collapsed width 50
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [platform, setPlatform] = useState<string>("Detecting...");
  const [activeCategory, setActiveCategory] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [inputRequest, setInputRequest] = useState<{
    id: string;
    prompt: string;
  } | null>(null);
  const [passwordInput, setPasswordInput] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [theme, setTheme] = useState<string>("dark");

  // System Info Modal State
  const [systemInfo, setSystemInfo] = useState<any>(null);
  const [showSysInfoModal, setShowSysInfoModal] = useState(false);

  // App Info Modal State
  const [appVersion, setAppVersion] = useState<string>("");
  const [showAppInfoModal, setShowAppInfoModal] = useState(false);

  // Resizable UI State
  const [consoleHeight, setConsoleHeight] = useState(220);
  const [isResizing, setIsResizing] = useState<"SIDEBAR" | "CONSOLE" | null>(
    null,
  );

  const consoleEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    const newTheme = theme === "dark" ? "light" : "dark";
    setTheme(newTheme);
    window.api.saveUIState(sidebarWidth, isCollapsed, viewMode, newTheme);
  };

  useEffect(() => {
    const init = async () => {
      const p = await window.api.getPlatform();
      setPlatform(p === "darwin" ? "macOS" : "Windows");

      // Restore UI state
      const uiState = await window.api.getUIState();
      setSidebarWidth(uiState.sidebarWidth);
      setIsCollapsed(uiState.isCollapsed);
      if (uiState.viewMode) setViewMode(uiState.viewMode as "grid" | "list");
      if (uiState.theme) {
        setTheme(uiState.theme);
      }

      const s = await window.api.getSoftware();
      setSoftware(s);

      const inv = await window.api.getInventory();
      setInventory(inv);
    };
    init();

    // Listeners with cleanup
    const cleanups = [
      window.api.onInstallLog((log: any) => {
        // Detect retry messages and ensure software is in processing state
        if (
          log.text &&
          (log.text.includes("Auto-retry") || log.text.includes("retrying"))
        ) {
          setProcessing((prev) => {
            const next = new Set(prev);
            next.add(log.id);
            return next;
          });
        }

        setLogs((prev) => {
          const newLog = { ...log, timestamp: new Date().toLocaleTimeString() };
          if (log.replace && prev.length > 0) {
            // Only replace if the last log was also a replaceable progress log (or just similar context)
            // Actually simplistic: if replace is true, just swap the last line.
            return [...prev.slice(0, -1), newLog];
          }
          return [...prev, newLog];
        });
      }),
      window.api.onInstallSuccess((data: any) => {
        setProcessing((prev) => {
          const next = new Set(prev);
          next.delete(data.id);
          return next;
        });
        setProgress((prev) => {
          const next = { ...prev };
          delete next[data.id];
          return next;
        });
        setLogs((prev) => [
          ...prev,
          {
            text: data.text || `Successfully processed ${data.name}!`,
            type: "success",
            timestamp: new Date().toLocaleTimeString(),
          },
        ]);
        // Refresh inventory
        window.api.getInventory().then(setInventory);
      }),
      window.api.onInstallError((data: any) => {
        setProcessing((prev) => {
          const next = new Set(prev);
          next.delete(data.id);
          return next;
        });
        setProgress((prev) => {
          const next = { ...prev };
          delete next[data.id];
          return next;
        });
        setLogs((prev) => [
          ...prev,
          {
            text: data.error,
            type: "error",
            timestamp: new Date().toLocaleTimeString(),
          },
        ]);
      }),
      window.api.onInstallProgress((data: any) => {
        // Ensure software is in processing state when progress arrives
        // This handles cases where retry happens but log hasn't arrived yet
        setProcessing((prev) => {
          if (data?.id && !prev.has(data.id)) {
            console.log(
              "[UI] Progress update for non-processing software, adding to processing:",
              data.id,
            );
            const next = new Set(prev);
            next.add(data.id);
            return next;
          }
          return prev;
        });

        if (data?.id) {
          setProgress((prev) => ({ ...prev, [data.id]: data.percent }));
        }
      }),
      window.api.onInstallInputRequest((data: any) => {
        setInputRequest(data);
        // Auto-scroll to show prompt
        setTimeout(
          () => consoleEndRef.current?.scrollIntoView({ behavior: "smooth" }),
          100,
        );
      }),
    ];

    return () => cleanups.forEach((fn) => fn());
  }, []);

  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const toggleSelect = (id: string) => {
    if (processing.has(id)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDeploy = () => {
    const toInstall = Array.from(selected).filter((id) => !inventory[id]);
    if (toInstall.length === 0) return;

    setProcessing((prev) => {
      const next = new Set(prev);
      toInstall.forEach((id) => next.add(id));
      return next;
    });
    toInstall.forEach((id) => window.api.installSoftware(id));
    // Only clear installed items from selection? No, usually clear all handled.
    // But for mixed selection, we might want to keep the unhandled ones?
    // Let's clear the ones we handled.
    setSelected((prev) => {
      const next = new Set(prev);
      toInstall.forEach((id) => next.delete(id));
      return next;
    });
  };

  const handleUninstallSelection = () => {
    const toUninstall = Array.from(selected).filter((id) => inventory[id]);
    if (toUninstall.length === 0) return;

    if (
      confirm(
        `Are you sure you want to uninstall ${toUninstall.length} applications?`,
      )
    ) {
      setProcessing((prev) => {
        const next = new Set(prev);
        toUninstall.forEach((id) => next.add(id));
        return next;
      });

      toUninstall.forEach((id) => {
        window.api.uninstallSoftware(id);
      });

      setSelected((prev) => {
        const next = new Set(prev);
        toUninstall.forEach((id) => next.delete(id));
        return next;
      });
    }
  };

  const handleUninstall = (id: string) => {
    const item = software.find((s) => s.id === id);
    if (!item) return;
    if (confirm(`Are you sure you want to uninstall ${item.name}?`)) {
      setProcessing((prev) => new Set(prev).add(id));
      setLogs((prev) => [
        ...prev,
        {
          text: `Requesting uninstallation of ${item.name}...`,
          type: "info",
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);
      window.api.uninstallSoftware(id);
    }
  };

  const handleCancel = (id: string) => {
    window.api.cancelInstallation(id);
    setProcessing((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setLogs((prev) => [
      ...prev,
      {
        text: `Action cancelled by user.`,
        type: "warning",
        timestamp: new Date().toLocaleTimeString(),
      },
    ]);
  };

  const handleStopAll = () => {
    if (
      confirm(
        "EMERGENCY STOP: This will force kill all running installations. Are you sure?",
      )
    ) {
      window.api.stopAllTasks();
      setProcessing(new Set());
      setProgress({});
      setLogs((prev) => [
        ...prev,
        {
          text: "*** EMERGENCY STOP TRIGGERED - ALL TASKS HALTED ***",
          type: "error",
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);
    }
  };

  const [isCopied, setIsCopied] = useState(false);

  const handleCopyLogs = () => {
    const text = logs
      .map(
        (l) =>
          `[${l.timestamp}] [${l.type?.toUpperCase() || "INFO"}] ${l.text}`,
      )
      .join("\n");
    navigator.clipboard.writeText(text);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 600);
  };

  const categories = ["All", ...new Set(software.map((s) => s.category))];

  const filteredSoftware = software
    .filter((s) => activeCategory === "All" || s.category === activeCategory)
    .filter((s) => s.name.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  const categoryCounts = software.reduce(
    (acc, item) => {
      acc[item.category] = (acc[item.category] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  categoryCounts["All"] = software.length;

  const installCount = Array.from(selected).filter(
    (id) => !inventory[id],
  ).length;
  const uninstallCount = Array.from(selected).filter(
    (id) => inventory[id],
  ).length;

  useEffect(() => {
    if (isResizing) {
      const handleMouseMove = (e: MouseEvent) => {
        if (isResizing === "SIDEBAR") {
          const newWidth = e.clientX;
          if (newWidth < 100) {
            setSidebarWidth(60);
            setIsCollapsed(true);
          } else {
            const clampedWidth = Math.min(Math.max(newWidth, 170), 600);
            setSidebarWidth(clampedWidth);
            setIsCollapsed(false);
          }
        } else if (isResizing === "CONSOLE") {
          const newHeight = window.innerHeight - e.clientY;
          const clampedHeight = Math.min(
            Math.max(newHeight, 150),
            window.innerHeight - 200,
          );
          setConsoleHeight(clampedHeight);
        }
      };

      const handleMouseUp = () => {
        setIsResizing(null);
        // Save UI state when resizing stops
        window.api.saveUIState(sidebarWidth, isCollapsed);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor =
        isResizing === "SIDEBAR" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";

      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
    }
    return undefined;
  }, [isResizing, sidebarWidth, isCollapsed]);

  const handleShowAppInfo = async () => {
    try {
      const v = await window.api.getAppVersion();
      setAppVersion(v);
      setShowAppInfoModal(true);
    } catch (error) {
      console.error("Failed to get app version:", error);
    }
  };

  const handleShowSystemInfo = async () => {
    try {
      const info = await window.api.getSystemDetails();
      setSystemInfo(info);
      setShowSysInfoModal(true);
    } catch (error) {
      console.error("Failed to get system info:", error);
    }
  };

  return (
    <>
      <div
        className="sidebar"
        style={{
          width: sidebarWidth,
          padding: isCollapsed ? "1rem 0" : "1.5rem",
          alignItems: isCollapsed ? "center" : "flex-start",
          transition: isResizing ? "none" : "width 0.1s ease", // Smooth snap, instant drag
          overflow: "hidden",
        }}
      >
        <div
          className="logo-section"
          onClick={handleShowAppInfo}
          style={{
            marginBottom: "2rem",
            textAlign: isCollapsed ? "center" : "left",
            width: "100%",
            display: "flex",
            justifyContent: isCollapsed ? "center" : "flex-start",
            cursor: "pointer",
          }}
          title="About OneClickInstall"
        >
          {isCollapsed ? (
            <h1 style={{ fontSize: "1.5rem" }}>🚀</h1>
          ) : (
            <h1>OneClickInstall</h1>
          )}
        </div>

        <div
          className="sidebar-nav"
          style={{
            width: "100%",
            alignItems: isCollapsed ? "center" : "stretch",
          }}
        >
          {!isCollapsed && <p className="sidebar-title">System Health</p>}
          <div
            className="btn btn-outline"
            onClick={handleShowSystemInfo}
            style={{
              cursor: "pointer",
              border: "none",
              background: "var(--bg-button-hover)",
              justifyContent: isCollapsed ? "center" : "flex-start",
              padding: isCollapsed ? "10px" : "0.75rem 1rem",
              width: isCollapsed ? "40px" : "100%",
              height: isCollapsed ? "40px" : "auto",
              borderRadius: "8px",
            }}
            title="Click for System Info"
          >
            <Cpu size={18} />
            {!isCollapsed && <span>{platform}</span>}
          </div>

          {!isCollapsed && <p className="sidebar-title">Orchestration</p>}
          <button
            className="btn btn-primary"
            onClick={handleDeploy}
            disabled={
              Array.from(selected).filter((id) => !inventory[id]).length === 0
            }
            style={{
              justifyContent: isCollapsed ? "center" : "flex-start",
              padding: isCollapsed ? "10px" : "0.75rem 1rem",
              width: isCollapsed ? "40px" : "100%",
              height: isCollapsed ? "40px" : "auto",
              borderRadius: "8px",
            }}
            title="Install Selection"
          >
            <Download size={18} />
            {!isCollapsed && (
              <>Install Selection {installCount > 0 && `(${installCount})`}</>
            )}
          </button>
          <button
            className="btn btn-outline"
            onClick={handleUninstallSelection}
            disabled={
              Array.from(selected).filter((id) => inventory[id]).length === 0
            }
            style={{
              borderColor: "rgba(239, 68, 68, 0.5)",
              color: "var(--text-danger)",
              justifyContent: isCollapsed ? "center" : "flex-start",
              padding: isCollapsed ? "10px" : "0.75rem 1rem",
              width: isCollapsed ? "40px" : "100%",
              height: isCollapsed ? "40px" : "auto",
              borderRadius: "8px",
            }}
            title="Uninstall Selection"
          >
            <Trash2 size={18} />
            {!isCollapsed && (
              <>
                Uninstall Selection{" "}
                {uninstallCount > 0 && `(${uninstallCount})`}
              </>
            )}
          </button>

          {!isCollapsed && (
            <p
              className="sidebar-title"
              style={{ marginTop: "auto", color: "#ef4444" }}
            >
              Danger Zone
            </p>
          )}
          <button
            className="btn"
            onClick={handleStopAll}
            style={{
              marginTop: isCollapsed ? "auto" : 0,
              background: "var(--bg-danger-soft)",
              color: "#ef4444",
              border: "1px solid #ef4444",
              fontWeight: "bold",
              justifyContent: isCollapsed ? "center" : "flex-start",
              padding: isCollapsed ? "10px" : "0.75rem 1rem",
              width: isCollapsed ? "40px" : "100%",
              height: isCollapsed ? "40px" : "auto",
              borderRadius: "8px",
            }}
            title="STOP ALL"
          >
            <ShieldCheck size={18} />
            {!isCollapsed && "STOP ALL"}
          </button>
        </div>
      </div>
      <div className="resizer-x" onMouseDown={() => setIsResizing("SIDEBAR")} />
      <div className="app-container">
        <div className="top-bar">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "1rem",
              flex: 1,
            }}
          >
            <Search size={18} color="var(--text-muted)" />
            <input
              type="text"
              className="search-input"
              placeholder="Search catalog..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                background: "none",
                border: "none",
                color: "var(--text-main)",
                fontSize: "0.9rem",
                outline: "none",
                width: "100%",
              }}
            />
          </div>

          {searchQuery && (
            <div
              className="badge"
              style={{
                background: "rgba(59, 130, 246, 0.2)",
                color: "#60a5fa",
              }}
            >
              {filteredSoftware.length} Matches
            </div>
          )}
          <div className="badge">{selected.size} Selected</div>

          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginLeft: '1rem' }}>
            <button
              onClick={toggleTheme}
              style={{
                background: "none",
                border: "none",
                color: "var(--text-secondary)",
                cursor: "pointer",
                padding: "8px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                opacity: 0.8,
                transition: "opacity 0.2s"
              }}
              title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.8")}
            >
              {theme === "dark" ? <Sun size={20} /> : <Moon size={20} />}
            </button>

            <div style={{ width: 1, height: 24, background: 'var(--border)', margin: '0 4px' }}></div>
            <button
              className={`btn-icon ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => { setViewMode('grid'); window.api.saveUIState(sidebarWidth, isCollapsed, 'grid'); }}
              title="Grid View"
            >
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px', width: '14px', height: '14px' }}>
                <div style={{ background: 'currentColor', borderRadius: '1px' }} />
                <div style={{ background: 'currentColor', borderRadius: '1px' }} />
                <div style={{ background: 'currentColor', borderRadius: '1px' }} />
                <div style={{ background: 'currentColor', borderRadius: '1px' }} />
              </div>
            </button>
            <button
              className={`btn-icon ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => { setViewMode('list'); window.api.saveUIState(sidebarWidth, isCollapsed, 'list'); }}
              title="List View"
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', width: '14px', height: '14px' }}>
                <div style={{ background: 'currentColor', height: '2px', borderRadius: '1px' }} />
                <div style={{ background: 'currentColor', height: '2px', borderRadius: '1px' }} />
                <div style={{ background: 'currentColor', height: '2px', borderRadius: '1px' }} />
                <div style={{ background: 'currentColor', height: '2px', borderRadius: '1px' }} />
              </div>
            </button>
          </div>
        </div>

        <div className="category-tabs">
          {categories.map((cat) => (
            <div
              key={cat}
              className={`tab ${activeCategory === cat ? "active" : ""}`}
              onClick={() => setActiveCategory(cat)}
            >
              {cat}{" "}
              <span
                style={{ opacity: 0.5, fontSize: "0.85em", marginLeft: "4px" }}
              >
                ({categoryCounts[cat] || 0})
              </span>
            </div>
          ))}
        </div>

        <div className="scroll-area">
          {viewMode === 'grid' ? (
            <div className="software-grid">
              {filteredSoftware.map((item) => (
                <div
                  key={item.id}
                  className={`card ${selected.has(item.id) ? (inventory[item.id] ? "selected-uninstall" : "selected") : ""} ${inventory[item.id] ? "installed" : ""}`}
                  onClick={() => toggleSelect(item.id)}
                >
                  <div className="card-title">
                    {item.name}
                    <div
                      style={{
                        display: "flex",
                        gap: "8px",
                        alignItems: "center",
                      }}
                    >
                      {processing.has(item.id) ? (
                        <div
                          className="badge"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCancel(item.id);
                          }}
                          style={{
                            cursor: "pointer",
                            background: "rgba(239, 68, 68, 0.1)",
                            color: "#ef4444",
                          }}
                        >
                          CANCEL
                        </div>
                      ) : inventory[item.id] ? (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                          }}
                        >
                          <span className="status-label">Already Installed</span>
                          <div className="installed-dot" />
                          {!processing.has(item.id) && (
                            <Trash2
                              size={18}
                              color="#ef4444"
                              className="uninstall-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleUninstall(item.id);
                              }}
                            />
                          )}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="card-desc">{item.description}</div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginTop: "1rem",
                    }}
                  >
                    <div style={{ display: "flex", gap: "8px" }}>
                      <div className="badge">{item.category}</div>
                      {item.size && (
                        <div
                          className="badge"
                          style={{ color: "var(--text-main)", opacity: 0.6 }}
                        >
                          {item.size}
                        </div>
                      )}
                    </div>
                    {processing.has(item.id) &&
                      progress[item.id] !== undefined && (
                        <span className="progress-text">
                          {Math.round(progress[item.id])}%
                        </span>
                      )}
                  </div>
                  {processing.has(item.id) && (
                    <div className="progress-container">
                      <div
                        className="progress-bar"
                        style={{ width: `${progress[item.id] || 0}%` }}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="software-list">
              <div className="list-header">
                <div className="col-check"></div>
                <div className="col-name">Name</div>
                <div className="col-cat">Category</div>
                <div className="col-size">Size</div>
                <div className="col-status">Status</div>
                <div className="col-actions">Actions</div>
              </div>
              {filteredSoftware.map((item) => (
                <div
                  key={item.id}
                  className={`list-row ${selected.has(item.id) ? 'selected' : ''} ${inventory[item.id] ? 'installed' : ''}`}
                  onClick={() => toggleSelect(item.id)}
                >
                  <div className="col-check">
                    <div className={`checkbox ${selected.has(item.id) ? 'checked' : ''}`}>
                      {selected.has(item.id) && <Check size={12} color="white" />}
                    </div>
                  </div>
                  <div className="col-name">
                    <span style={{ fontWeight: 600 }}>{item.name}</span>
                    {processing.has(item.id) && (
                      <div className="list-progress-container">
                        <div className="list-progress-bar" style={{ width: `${progress[item.id] || 0}%` }}></div>
                      </div>
                    )}
                  </div>
                  <div className="col-cat"><span className="badge">{item.category}</span></div>
                  <div className="col-size" style={{ opacity: 0.7, fontSize: '0.8rem' }}>{item.size || '-'}</div>
                  <div className="col-status">
                    {processing.has(item.id) ? (
                      <span className="badge" style={{ color: '#60a5fa' }}>Installing...</span>
                    ) : inventory[item.id] ? (
                      <span className="badge badge-success">Installed</span>
                    ) : (
                      <span className="badge" style={{ opacity: 0.5 }}>Not Installed</span>
                    )}
                  </div>
                  <div className="col-actions">
                    {processing.has(item.id) ? (
                      <button className="btn-icon-sm danger" onClick={(e) => { e.stopPropagation(); handleCancel(item.id); }}>
                        <span style={{ fontSize: '10px' }}>CANCEL</span>
                      </button>
                    ) : inventory[item.id] ? (
                      <button className="btn-icon-sm danger" onClick={(e) => { e.stopPropagation(); handleUninstall(item.id); }} title="Uninstall">
                        <Trash2 size={14} />
                      </button>
                    ) : (
                      <button className="btn-icon-sm primary" onClick={(e) => { e.stopPropagation(); toggleSelect(item.id); }} title="Select">
                        <Download size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div
          className="resizer-y"
          onMouseDown={() => setIsResizing("CONSOLE")}
        />
        <div className="console-panel" style={{ height: consoleHeight }}>
          <div className="console-header">
            <div className="console-title">
              <Terminal size={14} />
              COMMAND CENTER
            </div>
            <div
              className="console-title"
              style={{
                fontSize: "0.65rem",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <div
                title="Copy Logs"
                onClick={handleCopyLogs}
                style={{ cursor: "pointer", opacity: 0.7, display: "flex" }}
              >
                {isCopied ? (
                  <Check size={12} color="#4ade80" />
                ) : (
                  <Copy size={12} />
                )}
              </div>
              {processing.size > 0 ? "PROCESSING..." : "READY"}
            </div>
          </div>
          <div className="console-body">
            {logs.length === 0 && (
              <div style={{ color: "#475569" }}>
                Terminal ready. Awaiting deployment...
              </div>
            )}
            {logs.map((log, i) => (
              <div key={i} className="log-line">
                <span className="log-time">[{log.timestamp}]</span>
                <span
                  className={`log-content`}
                  style={{
                    color:
                      log.type === "error"
                        ? "#f87171"
                        : log.type === "success"
                          ? "#4ade80"
                          : log.type === "warning"
                            ? "#fbbf24"
                            : "#60a5fa",
                  }}
                >
                  {log.text}
                </span>
                {log.type === "warning" && log.text.includes("Stalled") && (
                  <button
                    onClick={() => {
                      window.api
                        .retryInstallation(log.id || "")
                        .then((result) => {
                          if (!result.success) {
                            console.error("Retry failed:", result.error);
                          }
                        });
                    }}
                    style={{
                      marginLeft: "10px",
                      padding: "4px 12px",
                      background: "#3b82f6",
                      color: "white",
                      border: "none",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontSize: "0.75rem",
                      fontWeight: "bold",
                    }}
                  >
                    🔄 Retry
                  </button>
                )}
              </div>
            ))}
            {inputRequest && (
              <div
                className="log-line"
                style={{
                  color: "var(--color-accent)",
                  fontWeight: "bold",
                  marginTop: "1rem",
                  background: "rgba(255, 200, 0, 0.1)",
                  padding: "10px",
                  borderRadius: "4px",
                }}
              >
                <span>{inputRequest.prompt}</span>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    window.api.submitInstallInput(
                      inputRequest.id,
                      passwordInput,
                    );
                    setLogs((prev: LogLine[]) => [
                      ...prev,
                      {
                        text: "***",
                        type: "info",
                        timestamp: new Date().toLocaleTimeString(),
                      },
                    ]);
                    setInputRequest(null);
                    setPasswordInput("");
                  }}
                  style={{ display: "flex", gap: "10px", marginTop: "5px" }}
                >
                  <input
                    type="password"
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                    placeholder="Enter password..."
                    autoFocus
                    style={{
                      background: "rgba(0,0,0,0.3)",
                      border: "1px solid var(--border-color)",
                      color: "white",
                      padding: "4px 8px",
                      borderRadius: "4px",
                      flex: 1,
                    }}
                  />
                  <button
                    type="submit"
                    className="btn btn-primary"
                    style={{ padding: "4px 12px", fontSize: "0.8rem" }}
                  >
                    Submit
                  </button>
                </form>
              </div>
            )}
            <div ref={consoleEndRef} />
          </div>
        </div>
      </div>

      {showAppInfoModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.7)",
            backdropFilter: "blur(5px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setShowAppInfoModal(false)}
        >
          <div
            style={{
              background: "#1e293b",
              border: "1px solid rgba(255,255,255,0.1)",
              padding: "2rem",
              borderRadius: "12px",
              width: "400px",
              boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
              position: "relative",
              textAlign: "center",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>🚀</div>
            <h2
              style={{
                marginBottom: "0.5rem",
                fontSize: "1.5rem",
                color: "white",
              }}
            >
              OneClickInstall
            </h2>
            <div style={{ color: "#94a3b8", marginBottom: "1.5rem" }}>
              Universal Software Deployment Platform
            </div>

            <div
              style={{
                background: "rgba(255,255,255,0.03)",
                padding: "1rem",
                borderRadius: "8px",
                marginBottom: "1.5rem",
              }}
            >
              <div
                style={{
                  fontSize: "0.75rem",
                  color: "#94a3b8",
                  textTransform: "uppercase",
                  marginBottom: "4px",
                }}
              >
                Version
              </div>
              <div
                style={{
                  fontWeight: "bold",
                  fontSize: "1.2rem",
                  color: "white",
                }}
              >
                {appVersion}
              </div>
            </div>

            <div style={{ fontSize: "0.8rem", color: "#64748b" }}>
              &copy; 2026 OneClickInstall Team
            </div>

            <button
              onClick={() => setShowAppInfoModal(false)}
              style={{
                width: "100%",
                marginTop: "1.5rem",
                padding: "0.75rem",
                background: "#3b82f6",
                color: "white",
                border: "none",
                borderRadius: "8px",
                fontWeight: "bold",
                cursor: "pointer",
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {showSysInfoModal && systemInfo && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.7)",
            backdropFilter: "blur(5px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setShowSysInfoModal(false)}
        >
          <div
            style={{
              background: "#1e293b",
              border: "1px solid rgba(255,255,255,0.1)",
              padding: "2rem",
              borderRadius: "12px",
              width: "500px",
              boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
              position: "relative",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              style={{
                marginBottom: "1.5rem",
                display: "flex",
                alignItems: "center",
                gap: "10px",
              }}
            >
              <Cpu size={24} color="#3b82f6" />
              System Information
            </h2>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "1rem",
              }}
            >
              <div
                style={{
                  background: "rgba(255,255,255,0.03)",
                  padding: "1rem",
                  borderRadius: "8px",
                }}
              >
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "#94a3b8",
                    textTransform: "uppercase",
                    marginBottom: "4px",
                  }}
                >
                  Hostname
                </div>
                <div style={{ fontWeight: "bold" }}>{systemInfo.hostname}</div>
              </div>
              <div
                style={{
                  background: "rgba(255,255,255,0.03)",
                  padding: "1rem",
                  borderRadius: "8px",
                }}
              >
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "#94a3b8",
                    textTransform: "uppercase",
                    marginBottom: "4px",
                  }}
                >
                  Platform
                </div>
                <div style={{ fontWeight: "bold" }}>{systemInfo.platform}</div>
              </div>
              <div
                style={{
                  background: "rgba(255,255,255,0.03)",
                  padding: "1rem",
                  borderRadius: "8px",
                }}
              >
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "#94a3b8",
                    textTransform: "uppercase",
                    marginBottom: "4px",
                  }}
                >
                  Architecture
                </div>
                <div style={{ fontWeight: "bold" }}>{systemInfo.arch}</div>
              </div>
              <div
                style={{
                  background: "rgba(255,255,255,0.03)",
                  padding: "1rem",
                  borderRadius: "8px",
                }}
              >
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "#94a3b8",
                    textTransform: "uppercase",
                    marginBottom: "4px",
                  }}
                >
                  CPU Cores
                </div>
                <div style={{ fontWeight: "bold" }}>{systemInfo.cpuCores}</div>
              </div>
              <div
                style={{
                  background: "rgba(255,255,255,0.03)",
                  padding: "1rem",
                  borderRadius: "8px",
                  gridColumn: "span 2",
                }}
              >
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "#94a3b8",
                    textTransform: "uppercase",
                    marginBottom: "4px",
                  }}
                >
                  CPU Model
                </div>
                <div style={{ fontWeight: "bold", fontSize: "0.9rem" }}>
                  {systemInfo.cpuModel}
                </div>
              </div>
              <div
                style={{
                  background: "rgba(255,255,255,0.03)",
                  padding: "1rem",
                  borderRadius: "8px",
                }}
              >
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "#94a3b8",
                    textTransform: "uppercase",
                    marginBottom: "4px",
                  }}
                >
                  Memory (Total)
                </div>
                <div style={{ fontWeight: "bold" }}>
                  {systemInfo.totalMemory}
                </div>
              </div>
              <div
                style={{
                  background: "rgba(255,255,255,0.03)",
                  padding: "1rem",
                  borderRadius: "8px",
                }}
              >
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "#94a3b8",
                    textTransform: "uppercase",
                    marginBottom: "4px",
                  }}
                >
                  Uptime
                </div>
                <div style={{ fontWeight: "bold" }}>{systemInfo.uptime}</div>
              </div>
            </div>

            <button
              onClick={() => setShowSysInfoModal(false)}
              style={{
                width: "100%",
                marginTop: "1.5rem",
                padding: "0.75rem",
                background: "#3b82f6",
                color: "white",
                border: "none",
                borderRadius: "8px",
                fontWeight: "bold",
                cursor: "pointer",
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export default App;

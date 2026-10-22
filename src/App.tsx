import {
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import {
  ArrowRightLeft,
  ShieldCheck,
  LockKeyhole,
  ArrowUpRight,
  Layers,
  Zap,
  UsersRound,
} from "lucide-react";
import { Tool } from "./components/Tool";
function PictureArt() {
  return (
    <svg viewBox="0 0 100 100" fill="none">
      <circle cx="36" cy="29" r="10" fill="currentColor" opacity=".7" />
      <path
        d="M10 80 34 44a6 6 0 0 1 10 0l14 21 9-13a6 6 0 0 1 10 1l17 27a5 5 0 0 1-4 8H14a5 5 0 0 1-4-8Z"
        fill="currentColor"
        opacity=".8"
      />
    </svg>
  );
}
export default function App() {
  const location = useLocation(),
    metadata = location.pathname === "/metadata-remover";
  return (
    <>
      <header>
        <div className="header-inner">
          <NavLink
            to="/converter"
            className="brand"
            aria-label="Image Toolkit home"
          >
            <img
              className="brand-logo"
              src={`${import.meta.env.BASE_URL}image-toolkit-logo.png`}
              alt="Image Toolkit"
              width="2172"
              height="724"
            />
          </NavLink>
          <nav aria-label="Image tools">
            <NavLink to="/converter">
              <ArrowRightLeft size={17} />
              <span>Image Converter</span>
            </NavLink>
            <NavLink to="/metadata-remover">
              <ShieldCheck size={18} />
              <span>Metadata Remover</span>
            </NavLink>
          </nav>
          <span className="header-privacy">
            <LockKeyhole size={14} />
            100% in your browser
          </span>
        </div>
      </header>
      <main>
        <div className="intro">
          <div className="eyebrow">
            <span /> SIMPLE TOOLS. COMPLETE PRIVACY.
          </div>
          <h1>
            {metadata ? "Share the image. " : "Your images, "}
            <span>
              {metadata ? "Keep your privacy." : "in the right format."}
            </span>
          </h1>
          <p>
            {metadata
              ? "Remove hidden details from your photos without changing their format."
              : "Convert images in a few clicks. No uploads, no accounts, no fuss."}
          </p>
          <div className="hero-features">
            <div>
              <LockKeyhole />
              <span>
                <strong>Private</strong>
                <small>Stays in your browser</small>
              </span>
            </div>
            <div>
              {metadata ? <ShieldCheck /> : <Zap />}
              <span>
                <strong>{metadata ? "Verified" : "Fast"}</strong>
                <small>
                  {metadata ? "Removes metadata safely" : "Convert in seconds"}
                </small>
              </span>
            </div>
            <div>
              <Layers />
              <span>
                <strong>
                  {metadata ? "Format-preserving" : "Batch-ready"}
                </strong>
                <small>
                  {metadata ? "Keeps original quality" : "Up to 50 images"}
                </small>
              </span>
            </div>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="art-tile art-back">
              <PictureArt />
            </div>
            <div className="art-tile art-small">
              <PictureArt />
            </div>
            <div className="art-tile art-front">
              <PictureArt />
            </div>
            <div className="art-badge">
              {metadata ? <ShieldCheck /> : <ArrowUpRight />}
            </div>
          </div>
        </div>
        <div className="workspace">
          <Routes>
            <Route path="/" element={<Navigate to="/converter" replace />} />
            <Route path="/converter" element={null} />
            <Route path="/metadata-remover" element={null} />
            <Route path="*" element={<Navigate to="/converter" replace />} />
          </Routes>
          <div hidden={metadata}>
            <Tool mode="converter" />
          </div>
          <div hidden={!metadata}>
            <Tool mode="metadata" />
          </div>
        </div>
        <div className="benefits">
          <div>
            <LockKeyhole />
            <span>
              <strong>Private by design</strong>
              <small>Your images never leave your device.</small>
            </span>
          </div>
          <div>
            <Layers />
            <span>
              <strong>Made for your workflow</strong>
              <small>One image or a whole batch.</small>
            </span>
          </div>
          <div>
            <UsersRound />
            <span>
              <strong>Simple. Free. Yours.</strong>
              <small>No sign-up, tracking or hidden fees.</small>
            </span>
          </div>
        </div>
        <section className="privacy-note">
          <ShieldCheck size={22} />
          <div>
            <strong>Your files stay with you.</strong>
            <p>
              All image processing happens locally in your browser. Files are
              held in memory and cleared when you close or refresh this page.
              Nothing is uploaded or saved by this app.
            </p>
          </div>
        </section>
      </main>
      <footer>
        <span>
          <b>
            Image <em>Toolkit</em>
          </b>
          <small>Thoughtful tools for everyday images.</small>
        </span>
        <a
          href="https://github.com/noorisysba/image-toolkit"
          target="_blank"
          rel="noreferrer"
        >
          View on GitHub <ArrowUpRight size={14} />
        </a>
      </footer>
    </>
  );
}

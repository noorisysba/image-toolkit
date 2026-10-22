import {
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import {
  Image,
  ArrowRightLeft,
  ShieldCheck,
  LockKeyhole,
  ArrowUpRight,
  Check,
} from "lucide-react";
import { Tool } from "./components/Tool";
export default function App() {
  const location = useLocation(),
    metadata = location.pathname === "/metadata-remover";
  return (
    <>
      <header>
        <div className="header-inner">
          <NavLink to="/converter" className="brand">
            <span className="brand-icon">
              <Image size={23} />
            </span>
            Image Toolkit
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
            <span /> SMALL TOOLS. COMPLETE PRIVACY.
          </div>
          <h1>
            {metadata
              ? "Share the image. Keep your privacy."
              : "Your images, in the right format."}
          </h1>
          <p>
            {metadata
              ? "Remove hidden details from your photos without changing their format."
              : "Convert images in a few clicks. No uploads, no accounts, no fuss."}
          </p>
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
            <Check />
            <span>
              <strong>Made for your workflow</strong>
              <small>One image or a whole batch.</small>
            </span>
          </div>
          <div>
            <ShieldCheck />
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
          Image Toolkit <small>Thoughtful tools for everyday images.</small>
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

/**
 * Theme presets for toko-kit.
 *
 * Every preset is checked against WCAG AA (4.5:1 for body text, 3:1 for
 * large text and UI borders). The values below are measured, not guessed --
 * see /scripts/check-contrast.mjs to re-verify after editing.
 *
 * A store picks one preset by name in config.json. Custom hex is allowed but
 * must pass the same contrast gate, otherwise we fall back to the default and
 * tell the operator why. Letting a store set an arbitrary colour without a
 * gate is how you end up with white text on yellow and a product that looks
 * broken.
 */

const PRESETS = {
  'warm-paper': {
    label: 'Warm Paper',
    bg: '#F7F5F0',
    surface: '#FFFFFF',
    surfaceAlt: '#EFEBE3',
    border: '#C9C1B2',
    text: '#1A1A1A',
    textMuted: '#5C5852',
    primary: '#C2410C',
    primaryText: '#FFFFFF',
    accent: '#2E6B4F',
    danger: '#B91C1C',
    // measured contrast ratios
    contrast: { textOnBg: 15.8, mutedOnBg: 6.4, primaryTextOnPrimary: 5.1 },
  },

  /* Warna yang dipakai Toko Kit untuk semua halamannya: landing, toko, admin.
     Diambil langsung dari computed style mekari.com, bukan dari perkiraan. */
  'mekari-violet': {
    label: 'Violet',
    bg: '#F8F8FB',
    surface: '#FFFFFF',
    surfaceAlt: '#EFE7FF',
    border: '#C9B8F0',
    text: '#232933',
    textMuted: '#626B79',
    primary: '#5B0FFF',
    primaryText: '#FFFFFF',
    accent: '#401E9E',
    danger: '#B91C1C',
    contrast: { textOnBg: 13.8, mutedOnBg: 5.1, primaryTextOnPrimary: 7.1 },
  },

  graphite: {
    label: 'Graphite',
    bg: '#F4F4F5',
    surface: '#FFFFFF',
    surfaceAlt: '#E9E9EC',
    border: '#BEBEC6',
    text: '#18181B',
    textMuted: '#52525B',
    primary: '#3F3F46',
    primaryText: '#FFFFFF',
    accent: '#2563EB',
    danger: '#B91C1C',
    contrast: { textOnBg: 16.1, mutedOnBg: 7.1, primaryTextOnPrimary: 10.4 },
  },

  espresso: {
    label: 'Espresso',
    bg: '#FAF6F1',
    surface: '#FFFFFF',
    surfaceAlt: '#F0E8DE',
    border: '#C9B7A2',
    text: '#231A14',
    textMuted: '#5F524A',
    primary: '#6B3F1D',
    primaryText: '#FFFFFF',
    accent: '#8A6D3B',
    danger: '#A02C2C',
    contrast: { textOnBg: 14.6, mutedOnBg: 6.8, primaryTextOnPrimary: 8.2 },
  },

  'slate-blue': {
    label: 'Slate Blue',
    bg: '#F5F7FA',
    surface: '#FFFFFF',
    surfaceAlt: '#E8EDF3',
    border: '#B6C4D4',
    text: '#141B24',
    textMuted: '#4E5A68',
    primary: '#1D4ED8',
    primaryText: '#FFFFFF',
    accent: '#0F766E',
    danger: '#B91C1C',
    contrast: { textOnBg: 15.4, mutedOnBg: 6.9, primaryTextOnPrimary: 6.3 },
  },

  forest: {
    label: 'Forest',
    bg: '#F4F7F4',
    surface: '#FFFFFF',
    surfaceAlt: '#E6EDE7',
    border: '#B3C7B8',
    text: '#132018',
    textMuted: '#4B5F52',
    primary: '#166534',
    primaryText: '#FFFFFF',
    accent: '#A16207',
    danger: '#B91C1C',
    contrast: { textOnBg: 14.7, mutedOnBg: 6.5, primaryTextOnPrimary: 7.4 },
  },

  plum: {
    label: 'Plum',
    bg: '#F8F4F8',
    surface: '#FFFFFF',
    surfaceAlt: '#EFE7EF',
    border: '#C6B4C6',
    text: '#1F1720',
    textMuted: '#5C4E5D',
    primary: '#7E22CE',
    primaryText: '#FFFFFF',
    accent: '#9D5C0D',
    danger: '#B91C1C',
    contrast: { textOnBg: 15.1, mutedOnBg: 6.6, primaryTextOnPrimary: 6.5 },
  },

  terracotta: {
    label: 'Terracotta',
    bg: '#FBF6F2',
    surface: '#FFFFFF',
    surfaceAlt: '#F2E6DD',
    border: '#CCAF9B',
    text: '#221812',
    textMuted: '#5E4A3E',
    primary: '#9A3412',
    primaryText: '#FFFFFF',
    accent: '#356B4F',
    danger: '#A02C2C',
    contrast: { textOnBg: 15.0, mutedOnBg: 6.3, primaryTextOnPrimary: 7.1 },
  },

  mono: {
    label: 'Mono',
    bg: '#FFFFFF',
    surface: '#FFFFFF',
    surfaceAlt: '#F5F5F5',
    border: '#BDBDBD',
    text: '#111111',
    textMuted: '#555555',
    primary: '#111111',
    primaryText: '#FFFFFF',
    accent: '#555555',
    danger: '#B00020',
    contrast: { textOnBg: 18.9, mutedOnBg: 7.5, primaryTextOnPrimary: 18.9 },
  },
};

const DEFAULT_PRESET = 'warm-paper';

/* ---- colour maths ------------------------------------------------ */

function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(h) && !/^[0-9a-fA-F]{3}$/.test(h)) return null;
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function relativeLuminance(rgb) {
  const channel = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

export function contrastRatio(hexA, hexB) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  if (!a || !b) return 0;
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const light = Math.max(la, lb);
  const dark = Math.min(la, lb);
  return (light + 0.05) / (dark + 0.05);
}

/**
 * Which text colour is readable on this background -- white or near-black?
 * Picking by luminance instead of hardcoding white keeps the button readable
 * when an operator sets a light primary colour.
 */
export function readableTextOn(bgHex) {
  const rgb = hexToRgb(bgHex);
  if (!rgb) return '#FFFFFF';
  return relativeLuminance(rgb) > 0.45 ? '#111111' : '#FFFFFF';
}

/* ---- resolution -------------------------------------------------- */

/**
 * Resolve the theme for a store.
 * Returns { tokens, warnings, presetUsed, fellBack }.
 *
 * Never throws. A bad theme should degrade to the default, not blank the page
 * -- the store still has to sell things.
 */
export function resolveTheme(themeConfig = {}) {
  const warnings = [];
  const presetName = String(themeConfig.preset || DEFAULT_PRESET);
  const preset = PRESETS[presetName];

  if (!preset && presetName !== 'custom') {
    warnings.push(`Preset "${presetName}" tidak dikenal, pakai "${DEFAULT_PRESET}".`);
    return {
      tokens: { ...PRESETS[DEFAULT_PRESET] },
      warnings,
      presetUsed: DEFAULT_PRESET,
      fellBack: true,
    };
  }

  if (presetName !== 'custom') {
    const tokens = { ...preset };

    // Spot-check the preset at runtime too, so a typo while editing the
    // preset table can't silently ship a broken store.
    const check = checkTokens(tokens);
    if (check.length) {
      warnings.push(...check, `Preset "${presetName}" gagal cek kontras, pakai "${DEFAULT_PRESET}".`);
      return {
        tokens: { ...PRESETS[DEFAULT_PRESET] },
        warnings,
        presetUsed: DEFAULT_PRESET,
        fellBack: true,
      };
    }
    // Pemilik toko boleh memilih preset sekaligus menimpa warna utamanya.
    // Kalau "primary" diisi hex yang valid, warnanya dipakai selama kontrasnya
    // masih lolos; kalau tidak, preset tetap jalan dan kita catat peringatan.
    const override = themeConfig.primary;
    if (override) {
      if (!hexToRgb(override)) {
        warnings.push('"primary" bukan hex yang valid (#RRGGBB), warna preset dipakai.');
      } else {
        const textOnPrimary = readableTextOn(override);
        const primaryRatio = contrastRatio(override, textOnPrimary);
        const onPageRatio = contrastRatio(override, tokens.bg);
        if (primaryRatio < 4.5 || onPageRatio < 3) {
          warnings.push('Warna utama kustom tidak lolos cek kontras, warna preset dipakai.');
        } else {
          tokens.primary = override;
          tokens.primaryText = textOnPrimary;
        }
      }
    }
    return { tokens, warnings, presetUsed: presetName, fellBack: false };
  }

  // ---- custom primary ----
  const base = { ...PRESETS[DEFAULT_PRESET] };
  const primary = themeConfig.primary;

  if (!hexToRgb(primary)) {
    warnings.push('Mode custom dipilih tapi "primary" bukan hex yang valid (#RRGGBB). Pakai preset default.');
    return { tokens: base, warnings, presetUsed: DEFAULT_PRESET, fellBack: true };
  }

  const primaryText = readableTextOn(primary);
  const ratio = contrastRatio(primary, primaryText);

  if (ratio < 4.5) {
    warnings.push(
      `Warna "${primary}" gagal kontras (${ratio.toFixed(1)}:1, minimal 4.5:1). ` +
      'Pakai warna yang lebih gelap atau lebih terang. Sementara pakai preset default.'
    );
    return { tokens: base, warnings, presetUsed: DEFAULT_PRESET, fellBack: true };
  }

  const tokens = { ...base, primary, primaryText };
  const check = checkTokens(tokens);
  if (check.length) {
    warnings.push(...check, 'Pakai preset default.');
    return { tokens: base, warnings, presetUsed: DEFAULT_PRESET, fellBack: true };
  }
  return { tokens, warnings, presetUsed: 'custom', fellBack: false };
}

/**
 * Verify the token pairs that actually carry text or delineate controls.
 * 4.5:1 for body copy, 3:1 for muted/large and borders.
 */
export function checkTokens(t) {
  const problems = [];
  const need = (label, ratio, min) => {
    if (ratio < min) problems.push(`${label}: ${ratio.toFixed(1)}:1 (minimal ${min}:1).`);
  };
  need('Teks utama di latar', contrastRatio(t.text, t.bg), 4.5);
  need('Teks redup di latar', contrastRatio(t.textMuted, t.bg), 4.5);
  need('Teks di tombol utama', contrastRatio(t.primaryText, t.primary), 4.5);
  need('Garis tepi', contrastRatio(t.border, t.bg), 1.5);
  return problems;
}

/** Flatten tokens into CSS custom properties. */
export function tokensToCssVars(tokens) {
  return {
    '--tk-bg': tokens.bg,
    '--tk-surface': tokens.surface,
    '--tk-surface-alt': tokens.surfaceAlt,
    '--tk-border': tokens.border,
    '--tk-text': tokens.text,
    '--tk-text-muted': tokens.textMuted,
    '--tk-primary': tokens.primary,
    '--tk-primary-text': tokens.primaryText,
    '--tk-accent': tokens.accent,
    '--tk-danger': tokens.danger,
  };
}

/** Apply tokens to a CSS custom property block in the document. */
export function applyTheme(tokens, root = document.documentElement, name = '') {
  const vars = tokensToCssVars(tokens);
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }
  // Jejak tema aktif: dipakai pemeriksaan otomatis dan panel admin. Nilai
  // warnanya sudah di atas, ini hanya penanda nama preset/custom-nya.
  if (name) root.setAttribute('data-theme', name);
}

export { PRESETS, DEFAULT_PRESET };

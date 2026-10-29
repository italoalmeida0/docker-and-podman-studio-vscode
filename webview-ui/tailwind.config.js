/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        'panel-bg': 'var(--vscode-editor-background)',
        'panel-card': 'var(--vscode-sideBar-background)',
        'panel-card-hover': 'var(--vscode-list-hoverBackground)',
        'panel-border': 'var(--vscode-panel-border, var(--vscode-widget-border, rgba(128,128,128,0.25)))',
        'sidebar-bg': 'var(--vscode-sideBar-background)',
        'sidebar-active': 'var(--vscode-list-activeSelectionBackground)',
        'sidebar-hover': 'var(--vscode-list-hoverBackground)',
        'text-primary': 'var(--vscode-foreground)',
        'text-secondary': 'var(--vscode-descriptionForeground)',
        'text-muted': 'var(--vscode-disabledForeground, rgba(150,150,150,0.75))',
        'accent-blue': 'var(--vscode-button-background, #3b82f6)',
        'accent-green': 'var(--vscode-testing-iconPassed, #4caf50)',
        'accent-orange': 'var(--vscode-editorWarning-foreground, #ff9800)',
        'accent-purple': 'var(--podman-purple, #892ca0)',
        'accent-magenta': 'var(--vscode-terminal-ansiMagenta, #ab47bc)',
        'accent-red': 'var(--vscode-errorForeground, #f44336)',
      },
      boxShadow: {
        card: '0 1px 3px rgba(0,0,0,0.14), 0 1px 2px rgba(0,0,0,0.10)',
        elevated: '0 10px 24px rgba(0,0,0,0.28), 0 4px 10px rgba(0,0,0,0.16)',
      },
      fontFamily: {
        mono: ['var(--vscode-editor-font-family)', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};

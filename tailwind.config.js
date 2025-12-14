/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#e6f2ff',
          100: '#cce5ff',
          200: '#99ccff',
          300: '#66b2ff',
          400: '#3399ff',
          500: '#007aff',  // iOS Blue
          600: '#0062cc',
          700: '#004999',
          800: '#003166',
          900: '#001933',
          950: '#000d1a',
        },
        secondary: {
          50: '#e6f9ed',
          100: '#ccf3db',
          200: '#99e7b7',
          300: '#66db93',
          400: '#4dd680',
          500: '#34c759',  // iOS Green
          600: '#2a9f47',
          700: '#1f7735',
          800: '#154f23',
          900: '#0a2712',
          950: '#051409',
        },
        accent: {
          50: '#e5f8fc',
          100: '#ccf1f9',
          200: '#99e3f3',
          300: '#66d5ed',
          400: '#33c7e7',
          500: '#5ac8fa',  // iOS Light Blue
          600: '#0082d1',
          700: '#00619d',
          800: '#004169',
          900: '#002035',
          950: '#00101a',
        },
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic': 'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
        'gradient-primary': 'linear-gradient(135deg, #007aff 0%, #5ac8fa 100%)',
        'gradient-secondary': 'linear-gradient(135deg, #34c759 0%, #30d158 100%)',
        'gradient-accent': 'linear-gradient(135deg, #5ac8fa 0%, #007aff 100%)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'spin-slow': 'spin 3s linear infinite',
        'gradient-shift': 'gradientShift 4s ease infinite',
        'slide-up': 'slideUp 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        'fade-in': 'fadeIn 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
      },
      boxShadow: {
        'glow-primary': '0 0 20px rgba(0, 122, 255, 0.3)',
        'glow-secondary': '0 0 20px rgba(52, 199, 89, 0.3)',
        'glow-accent': '0 0 20px rgba(90, 200, 250, 0.3)',
        'ios': '0 2px 10px rgba(0, 0, 0, 0.08)',
        'ios-lg': '0 8px 30px rgba(0, 0, 0, 0.12)',
      },
    },
  },
  plugins: [],
};

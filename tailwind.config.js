/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        sage: {
          DEFAULT: '#7C8B70',
          deep: '#5E6B54',
          soft: '#A3AE99',
          mist: '#E4E7DF',
        },
        cream: {
          DEFAULT: '#F6F3EE',
          card: '#FFFCF8',
        },
        ink: {
          DEFAULT: '#3D3A36',
          mute: '#7A756C',
          faint: '#A39D94',
        },
      },
      fontFamily: {
        serif: ['"Fraunces"', 'Georgia', 'serif'],
        sans: ['"Figtree"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        sheet: '0 -8px 40px rgba(61, 58, 54, 0.12)',
        card: '0 10px 30px rgba(61, 58, 54, 0.06)',
      },
    },
  },
  plugins: [],
}

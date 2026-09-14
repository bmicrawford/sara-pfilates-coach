export function replyAsSara(prompt: string): string {
  const q = prompt.toLowerCase()

  if (/drink|water|hydrat|tea|coffee|sip/.test(q)) {
    return "Little sips count. If you're logging drinks, you're already paying attention — that's the habit. Keep a glass where you actually sit."
  }
  if (/leak|pad|damp|accident|wet/.test(q)) {
    return "You're not doing anything wrong. Note the time and what was going on — patterns are kinder than guessing. The course lessons stay on Kajabi; I'm just here in your pocket."
  }
  if (/void|pee|bathroom|urge/.test(q)) {
    return "Good catch. Logging voids and urges helps you see the day without judging it. If an urge showed up, try one easy breath before you decide."
  }
  if (/exercis|squeeze|kegel|pfil|class|walk|stretch|minute|workout|set/.test(q)) {
    return "That's the good stuff. A short set you actually did beats a perfect one you skipped. Want to log it so we can cheer you on?"
  }
  if (/sleep|night|bed|overnight/.test(q)) {
    return "Nights can feel louder. A last sip earlier, a calm pad change, and no scorekeeping. Tomorrow is another gentle try."
  }
  if (/phone|device|move|switch/.test(q)) {
    return "This companion stays on one phone so it feels private. If you got a new one, there's a quiet move flow — nothing flashy."
  }

  return "I'm here. Tell me what's on your mind — drinks, leaks, a class, or just a weird day. I'll keep it simple and kind."
}

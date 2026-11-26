const fs = require("fs");
const path = require("path");

const BUILTIN_PACKS = {
  mohanlal: {
    malayalam: {
      title: "Brio",
      peek: "ഡാ മോനേ...!",
      drinking: "💧 കൂൾ... വെള്ളം!",
      nudge: "മോനേ... ഒരു സിപ് എടുക്കാം?",
      snooze: "ഓക്കേ മോനേ, പിന്നെ വരാം!",
      laterLabel: "Later ▾",
      laterDoubtLabel: "Reply ▾",
      laterAngryLabel: "Wait ▾",
      focusPeekWater: "തിരക്കിലാണോ? 💧",
      focusPeekBreak: "ചെറിയ ബ്രേക്ക്? 👀",
      replyLines: {
        snooze5: "👍 ശരി, 5 മിനിറ്റ് കഴിഞ്ഞ് വരാം!",
        snooze15: "👌 ഓക്കേ മോനേ, 15m കഴിഞ്ഞ് കാണാം!",
        snooze30: "✨ 30m ശല്യം ചെയ്യില്ല, ഉഷാറായി ചെയ്യൂ!",
        deepFocus: "🔥 കട്ട വർക്കിലാണല്ലേ? 20m കഴിഞ്ഞ് വരാം!",
        justHad: "💧 പൊളിച്ചു മോനേ! ആ സിപ് ആഡ് ചെയ്തു 👍",
        alreadyRested: "✨ കിടിലം! ബ്രേക്ക് കൗണ്ട് ചെയ്തു 👍",
        skipBreak: "👌 ഓക്കേ, ഈ ബ്രേക്ക് സ്കിപ്പ് ചെയ്യാം!",
      },
      refuse1: "😅 ഓക്കേ, കുറച്ച് കഴിഞ്ഞ് വരാം!",
      refuse2Title: "😕 ഉറപ്പാണോ?",
      refuse2Quote: "ഒരു ചെറിയ സിപ് പോലും വേണ്ടേ?",
      refuse3Title: "😤 കുടിക്ക് മോനേ!",
      refuse3Quote: "വേഗം ഒരു സിപ് വെള്ളം കുടിക്ക്!",
      dismiss: "ശരി മോനേ, പിന്നെ കാണാം!",
      milestone50: "🙌 പകുതി എത്തി! പൊളിച്ചു!",
      milestone100: "🏆 ഇന്നത്തെ ടാർഗറ്റ് ഫുൾ കിടിലം!",
      eyeBreak: "20s ദൂരേക്ക് നോക്കി കണ്ണുകൾക്ക് വിശ്രമം.",
      eyeBreakPrompt: "കണ്ണുകൾക്ക് 20s വിശ്രമം കൊടുക്കാം?",
      stretchPrompt: "ഒന്ന് എഴുന്നേറ്റ് സ്ട്രെച്ച് ചെയ്യാമോ?",
      standBreakPrompt: "🚶 {mins}m ആയി! {dur} നടന്നു വരാം?",
      pomodoroBreakPrompt: "25m കഴിഞ്ഞു! 5m ബ്രേക്ക് എടുക്കാം?",
      pomodoroWorkPrompt: "ബ്രേക്ക് തീർന്നു! വീണ്ടും തുടങ്ങാം?",
      systemHighLoadPrompt: "സിസ്റ്റം ചൂടാണല്ലോ! ചെറിയൊരു ബ്രേക്ക്?",
      systemLongActivePrompt: "ഒന്നര മണിക്കൂർ ആയി! ഒന്ന് എഴുന്നേൽക്കാം?",
      starvePrompt: "തൊണ്ട വരണ്ടു മോനേ... ഒരു സിപ്?",
      breakDoneMsg: "✨ ഫ്രഷ് ആയല്ലോ!",
      welcomeTemplate: "👋 ഹായ് {name} മോനേ, സുഖമാണോ?",
      welcomeReply: "🙌 സവാരി ഗിരി ഗിരി! കൂടെയുണ്ട്!",
      pillNormal: "💧 Drink!",
      pillDue: "💧 Drink!",
      pillDoubt: "😕 Sure?",
      pillAngry: "😠 DRINK IT!",
      pillPaused: "⏸ Paused",
      pillDnd: "🌙 DND",
      reminders: [
        "സവാരി ഗിരി ഗിരി... ഒരു സിപ് വെള്ളം?",
        "മോനേ, വെള്ളം കുടിക്കാം?",
        "ഒരു സിപ് വെള്ളം എടുക്കൂ ഡാ!",
        "5 സെക്കൻഡ് — ഒരു ഗ്ലാസ് വെള്ളം?",
        "വെള്ളം കുടിക്കാൻ സമയമായി മോനേ!",
        "കുഞ്ഞാറ്റേ, ഒരു സിപ് ആയാലോ?",
      ],
      reactions: [
        { kind: "salute", msg: "🙌 സവാരി ഗിരി ഗിരി! മോനേ, പൊളി!" },
        { kind: "thumbsup", msg: "👍 എന്റെ മോനേ... കിടുക്കാച്ചി!" },
        { kind: "happy", msg: "😊 അതാ നമ്മുടെ ചുണക്കുട്ടൻ!" },
        { kind: "salute", msg: "🔥 പിന്നെ അല്ല! വേറെ ലെവൽ മോനേ!" },
      ],
      hovers: [
        "എന്താ മോനേ വിശേഷം?",
        "വെള്ളം കുടിച്ചോ ഡാ?",
        "നമ്മൾ സെറ്റല്ലേ മോനേ!",
        "ഉഷാറായി ഇരിക്ക് മോനേ!",
      ],
      morningReminders: [
        "സുപ്രഭാതം! ഫ്രഷ് ആയി ഒരു സിപ്?",
        "രാവിലെ തന്നെ ഒരു ഗ്ലാസ് വെള്ളം?",
      ],
      chayaBreakReminders: [
        "ചായ ടൈം! ഒപ്പം ഒരു സിപ് വെള്ളം?",
        "വൈകുന്നേരമായല്ലോ — ഒരു ഗ്ലാസ് വെള്ളം?",
      ],
      lateNightReminders: [
        "രാത്രി വൈകിയല്ലോ — വെള്ളം കുടിച്ചിട്ട് ഉറങ്ങാം!",
        "ഒരു സിപ് വെള്ളം കുടിച്ച് വിശ്രമിക്കൂ മോനേ!",
      ],
      marathonReminders: [
        "1 മണിക്കൂറായി പണിയല്ലേ! ഒരു സിപ്?",
        "തല തണുപ്പിക്കാൻ ഒരു ഗ്ലാസ് വെള്ളം?",
      ],
      hotWeatherReminders: [
        "പുറത്ത് നല്ല ചൂടാ ({temp}°C)! ഒരു സിപ്?",
        "ചൂടല്ലേ ({temp}°C) — വെള്ളം കുടിക്ക് മോനേ!",
      ],
      codingReminders: [
        "കട്ട കോഡിംഗ് ആണല്ലേ! ഒരു സിപ്?",
        "അടുത്ത ബഗ്ഗിന് മുന്നേ ഒരു സിപ് വെള്ളം?",
      ],
      videoReminders: [
        "സിനിമയ്ക്കിടയിൽ ഒരു സിപ് വെള്ളം?",
        "കാണുന്നതിനൊപ്പം ഒരു സിപ് എടുക്കൂ!",
      ],
      breathingPrompt: "🌊 ശാന്തമാകൂ മോനേ! ശ്വാസം ഉള്ളിലേക്ക് എടുത്ത് പുറത്തേക്ക് വിടാം...",
      breathingDoneMsg: "😌 അടിപൊളി! മനസ്സും ശരീരവും ഫ്രഷ് ആയല്ലോ മോനേ!",
      weeklyReportTemplate:
        "📊 ഈ ആഴ്ചത്തെ റിപ്പോർട്ട്: {glasses} ഗ്ലാസ് ({ml} ml)! {goalDays} ദിവസം ലക്ഷ്യം തികച്ചു മോനേ! കിടിലം!",
      moodFreshReply: "🙌 സവാരി ഗിരി ഗിരി! നല്ല എനർജിയിൽ ഇന്ന് നമുക്ക് പൊളിക്കാം മോനേ!",
      moodSleepyPrompt: "😴 ഉറക്കം തൂങ്ങുന്നുണ്ടോ മോനേ? ഒന്ന് എഴുന്നേറ്റ് സ്ട്രെച്ച് ചെയ്ത് വെള്ളം കുടിക്ക്!",
      moodStressedPrompt: "🌊 ടെൻഷൻ വേണ്ട മോനേ! നമുക്കൊരു മിനിറ്റ് ശാന്തമായി ശ്വാസം വിടാം!",
      habitReminderTemplate: "⏰ മോനേ, സമയം ആയില്ലേ: {habit}!",
      habitDoneReply: "👍 കലക്കി മോനേ! ആ കാര്യവും സെറ്റായി!",
      stickyNotePrefix: "📌 മറക്കല്ലേ മോനേ: ",
      batteryLowTemplate: "🔌 ലാപ്ടോപ്പിന് ദാഹമായി മോനേ ({pct}%)! ഇപ്പോൾ ചാർജർ കുത്തൂ!",
      batteryFullTemplate: "🔋 ബാറ്ററി 100% ഫുൾ ആയി മോനേ! ഇനി ചാർജർ ഊരാം!",
      eodRecapTemplate:
        "🌙 ഇന്നത്തെ പണി മതി മോനേ! {glasses} ഗ്ലാസ് • 💼 {workTime} • ☕ {breakTime} • 🔥 {streak}d!",
      bedtimeTemplate:
        "🌙 സമയം {time} ആയി മോനേ! കണ്ണ് കഴച്ച് ഉറക്കം കളയാതെ ഇനി ലാപ്ടോപ്പ് അടച്ച് ഉറങ്ങാൻ നോക്ക്!",
      workStartReply: "💪 സെറ്റ് മോനേ! വർക്ക് ടൈമർ തുടങ്ങി — ഉഷാറായി ചെയ്യാം!",
      breakStartReply: "☕ ബ്രേക്ക് ടൈം മോനേ! കണ്ണിനും മനസ്സിനും ചെറിയ വിശ്രമം കൊടുക്കൂ!",
      workEndReply: "🌙 ഇന്നത്തെ വർക്ക് സെഷൻ കഴിഞ്ഞു മോനേ! അടിപൊളി പ്രൊഡക്ടിവിറ്റി!",
      scheduledBreakStartTemplate: "🍽 {title} സമയമായി മോനേ ({start}–{end})! ഇപ്പോൾ പണി നിർത്തി ബ്രേക്ക് എടുക്കൂ!",
      scheduledBreakEndTemplate: "⏰ {title} കഴിഞ്ഞു മോനേ! ഇനി തിരിച്ച് വർക്കിലേക്ക് വരാം!",
      specialWishes: {
        birthday: "🎂 ഹാപ്പി ബർത്ത്ഡേ {name} മോനേ!! സവാരി ഗിരി ഗിരി... അടിപൊളി വർഷം ആശംസിക്കുന്നു!",
        new_year: "🎆 ഹാപ്പി ന്യൂ ഇയർ മോനേ! ഈ വർഷം മുഴുവൻ പൊളിച്ചടുക്കാം!",
        vishu: "🌼 വിഷു ആശംസകൾ മോനേ! കൈനീട്ടവും ഉഷാറും ആകട്ടെ!",
        independence_day: "🇮🇳 സ്വാതന്ത്ര്യദിന ആശംസകൾ മോനേ! ജയ് ഹിന്ദ്!",
        republic_day: "🇮🇳 റിപ്പബ്ലിക് ദിന ആശംസകൾ മോനേ!",
        kerala_piravi: "🌴 കേരളപ്പിറവി ആശംസകൾ മോനേ!",
        christmas: "🎄 മെറി ക്രിസ്മസ് മോനേ! ഹാപ്പി ഹോളിഡേയ്സ്!",
      },
      poseLines: [
        { kind: "meesha", msg: "😎 മീശ പിരിച്ചാൽ പോരാ മോനേ... സമയത്തിന് വെള്ളവും കുടിക്കണം!" },
        { kind: "meesha", msg: "🔥 സവാരി ഗിരി ഗിരി! നമ്മൾ വേറെ ലെവൽ അല്ലേ!" },
        { kind: "salute", msg: "🙌 നീ പോ മോനേ ദിനേശാ... പണി നടക്കട്ടെ, വെള്ളം മറക്കണ്ട!" },
        { kind: "thumbsup", msg: "👍 കണ്ണിറുക്കി ചിരിച്ചോ മോനേ... എന്നാലും വെള്ളം കുടിച്ചോണം!" },
      ],
    },
    english: {
      title: "Brio",
      peek: "Hey, quick sip?",
      drinking: "💧 Cheers!",
      nudge: "Still here — quick sip?",
      snooze: "No rush — back soon!",
      laterLabel: "Later ▾",
      laterDoubtLabel: "Reply ▾",
      laterAngryLabel: "Wait ▾",
      focusPeekWater: "Busy? 💧",
      focusPeekBreak: "Quick break? 👀",
      replyLines: {
        snooze5: "👍 Got it — back in 5m!",
        snooze15: "👌 Finish up! Catch you in 15m.",
        snooze30: "✨ Quiet for 30m — stay in flow!",
        deepFocus: "🔥 Deep work mode! Ping in 20m.",
        justHad: "💧 Nice! Logged that sip 👍",
        alreadyRested: "✨ Awesome — break counted!",
        skipBreak: "👌 Skipped — carry on!",
      },
      refuse1: "😅 No worries, catch you soon!",
      refuse2Title: "😕 Sure?",
      refuse2Quote: "Not even one quick sip?",
      refuse3Title: "😤 Quick Sip!",
      refuse3Quote: "Hey boss — just one glass now!",
      dismiss: "Cool, carry on!",
      milestone50: "🙌 Halfway there! Solid!",
      milestone100: "🏆 Daily goal crushed!",
      eyeBreak: "Look 20ft away for 20s.",
      eyeBreakPrompt: "Eyes need a quick 20s rest?",
      stretchPrompt: "Quick desk stretch for your neck?",
      standBreakPrompt: "🚶 {mins}m sitting — {dur} stand & walk?",
      pomodoroBreakPrompt: "25m done! 5m breather?",
      pomodoroWorkPrompt: "Break over! Back to focus?",
      systemHighLoadPrompt: "PC running hot — quick breather?",
      systemLongActivePrompt: "90m straight! Stand & stretch?",
      starvePrompt: "Dry throat here... tiny sip?",
      breakDoneMsg: "✨ Back at 100%!",
      welcomeTemplate: "👋 Hey {name}, ready for today?",
      welcomeReply: "🙌 Awesome — I've got your back!",
      pillNormal: "✨ Brio",
      pillDue: "💧 Drink!",
      pillDoubt: "😕 Sure?",
      pillAngry: "😠 Sip!",
      pillPaused: "⏸ Paused",
      pillDnd: "🌙 DND",
      reminders: [
        "Hey boss — quick water check!",
        "Time for a quick sip? 💧",
        "Pause 5s for water?",
        "Grab a glass when you can!",
        "Quick hydration ping 💧",
        "One small sip to stay sharp?",
      ],
      reactions: [
        { kind: "thumbsup", msg: "👍 Pure class! Great job!" },
        { kind: "salute", msg: "🙌 Hero salute! Feeling super!" },
        { kind: "happy", msg: "😊 That's the spirit, boss!" },
        { kind: "thumbsup", msg: "🔥 Solid! Back to crushing it!" },
      ],
      hovers: [
        "How's it going?",
        "Had a sip yet?",
        "Staying sharp!",
        "Drink water, stay unstoppable!",
      ],
      morningReminders: [
        "Morning! First glass of water?",
        "Good morning! Quick sip to start?",
      ],
      chayaBreakReminders: [
        "Afternoon recharge — quick sip of water?",
        "Tea time! Grab some water too?",
      ],
      lateNightReminders: [
        "Late night hustle — quick sip of water?",
        "Still up? Take a sip and rest soon!",
      ],
      marathonReminders: [
        "60m+ hustle — brain wants water!",
        "Long sprint! Grab a quick sip?",
      ],
      hotWeatherReminders: [
        "Warm day ({temp}°C) — cool sip time!",
        "{temp}°C outside — stay hydrated!",
      ],
      codingReminders: [
        "In deep code — quick sip break?",
        "Next bug can wait 5s — sip?",
      ],
      videoReminders: [
        "Quick water check while watching?",
        "Grab a quick sip right here!",
      ],
      breathingPrompt: "🌊 Follow the glowing ring — inhale deeply, hold, and exhale calmly...",
      breathingDoneMsg: "😌 Calm and refreshed! Ready to shine again!",
      weeklyReportTemplate:
        "📊 Weekly Scorecard: {glasses} glasses ({ml} ml) & {goalDays} goal days hit! Superstar!",
      moodFreshReply: "🙌 Pure superstar energy! Let's make today awesome!",
      moodSleepyPrompt: "😴 Feeling sleepy? Stand up for a quick stretch and sip of water!",
      moodStressedPrompt: "🌊 Take it easy! Let's do a quick 1-minute calm breathing session!",
      habitReminderTemplate: "⏰ Quick reminder: Time for {habit}!",
      habitDoneReply: "👍 Awesome! Habit checked off!",
      stickyNotePrefix: "📌 Your Note: ",
      batteryLowTemplate: "🔌 Battery is low ({pct}%)! Plug in your charger soon, boss!",
      batteryFullTemplate: "🔋 Battery reached 100%! You can unplug the charger now!",
      eodRecapTemplate:
        "🌙 Great work today! {glasses} glasses • 💼 {workTime} • ☕ {breakTime} • 🔥 {streak}d!",
      bedtimeTemplate:
        "🌙 It's {time} already, boss! Close the screen for tonight and get some real sleep!",
      workStartReply: "💪 Clocked in! Work timer started — let's crush today!",
      breakStartReply: "☕ Break mode on! Step away and recharge for a few!",
      workEndReply: "🌙 Clocked out! Great focus today — time to unwind!",
      scheduledBreakStartTemplate: "🍽 Time for {title} ({start}–{end})! Pause work and recharge!",
      scheduledBreakEndTemplate: "⏰ {title} ended! Ready to get back to work?",
      specialWishes: {
        birthday: "🎂 Happy Birthday {name}!! Wishing you an iconic, superstar year ahead!",
        new_year: "🎆 Happy New Year! Let's make this year awesome!",
        vishu: "🌼 Happy Vishu! Wishing you joy and prosperity!",
        independence_day: "🇮🇳 Happy Independence Day!",
        republic_day: "🇮🇳 Happy Republic Day!",
        kerala_piravi: "🌴 Happy Kerala Piravi!",
        christmas: "🎄 Merry Christmas! Wishing you joy and warmth!",
      },
      poseLines: [
        { kind: "meesha", msg: "😎 Savari Giri Giri! Stay hydrated and unstoppable!" },
        { kind: "salute", msg: "🙌 Superstar salute! Keep crushing your goals!" },
        { kind: "thumbsup", msg: "👍 Looking sharp, boss! Don't forget your water!" },
      ],
    },
  },
  default: {
    malayalam: {
      title: "Time to Hydrate",
      peek: "വെള്ളം?",
      drinking: "💧 കുടിക്കുന്നു...",
      nudge: "ഒരു ചെറിയ സിപ്?",
      snooze: "ശരി, പിന്നെ വരാം.",
      laterLabel: "Later ▾",
      laterDoubtLabel: "Reply ▾",
      laterAngryLabel: "Wait ▾",
      focusPeekWater: "തിരക്കിലാണോ? 💧",
      focusPeekBreak: "ബ്രേക്ക്? 👀",
      replyLines: {
        snooze5: "👍 5 മിനിറ്റ് കഴിഞ്ഞ് വരാം!",
        snooze15: "👌 15m കഴിഞ്ഞ് ഓർമ്മിപ്പിക്കാം!",
        snooze30: "✨ 30m കഴിഞ്ഞു വരാം!",
        deepFocus: "🔥 വർക്ക് തുടരൂ, 20m കഴിഞ്ഞ് കാണാം!",
        justHad: "💧 സൂപ്പർ! ആ സിപ് ആഡ് ചെയ്തു 👍",
        alreadyRested: "✨ നന്നായി! ബ്രേക്ക് കൗണ്ട് ചെയ്തു 👍",
        skipBreak: "👌 സ്കിപ്പ് ചെയ്തു!",
      },
      refuse1: "😅 ശരി, പിന്നെ കാണാം.",
      refuse2Title: "😕 ഉറപ്പാണോ?",
      refuse2Quote: "ഒരു ചെറിയ സിപ് വേണ്ടേ?",
      refuse3Title: "😤 കുടിക്കൂ!",
      refuse3Quote: "വേഗം ഒരു സിപ് കുടിക്കൂ!",
      dismiss: "അടുത്ത റൗണ്ടിൽ കാണാം!",
      milestone50: "പകുതി ലക്ഷ്യം എത്തി!",
      milestone100: "ഇന്നത്തെ ലക്ഷ്യം പൂർത്തിയായി!",
      eyeBreak: "20s ദൂരേക്ക് നോക്കൂ.",
      eyeBreakPrompt: "20s കണ്ണുകൾക്ക് വിശ്രമം?",
      stretchPrompt: "ഒന്ന് സ്ട്രെച്ച് ചെയ്യാമോ?",
      standBreakPrompt: "🚶 {mins}m ആയി! {dur} നടക്കാം?",
      pomodoroBreakPrompt: "25 മിനിറ്റ് ഫോക്കസ് പൂർത്തിയായി! 5 മിനിറ്റ് വിശ്രമിച്ചാലോ?",
      pomodoroWorkPrompt: "വിശ്രമം കഴിഞ്ഞു! അടുത്ത ഫോക്കസ് സെഷൻ തുടങ്ങാമോ?",
      systemHighLoadPrompt: "സിസ്റ്റം ലോഡ് കൂടുതലാണ്! ചെറിയൊരു ബ്രേക്ക് എടുക്കാം?",
      systemLongActivePrompt: "90 മിനിറ്റിലധികമായി തുടർച്ചയായി സ്ക്രീനിൽ നോക്കുന്നു! വിശ്രമിച്ചാലോ?",
      starvePrompt: "വെള്ളം കുടിക്കാതെ ഞാൻ തളർന്നു... ഒരു സിപ് വെള്ളം കുടിക്കാമോ?",
      breakDoneMsg: "✨ ബ്രേക്ക് പൂർത്തിയായി! വളരെ നല്ലത്!",
      welcomeTemplate: "👋 ഹായ് {name}, സുഖമാണോ? നല്ലൊരു ദിവസം ആശംസിക്കുന്നു!",
      welcomeReply: "😊 വളരെ നല്ലത്! സമയമാകുമ്പോൾ വെള്ളം കുടിക്കാൻ ഓർമ്മിപ്പിക്കാം!",
      pillNormal: "💧 Drink!",
      pillDue: "💧 Drink!",
      pillDoubt: "😕 Sure?",
      pillAngry: "😠 DRINK IT!",
      pillPaused: "⏸ Paused",
      pillDnd: "🌙 DND",
      reminders: [
        "വെള്ളം കുടിക്കാൻ സമയമായല്ലോ, ഒരു സിപ് കുടിച്ചാലോ?",
        "ഒരു ഗ്ലാസ് വെള്ളം കുടിക്കാമോ?",
        "ചെറിയൊരു വെള്ളം കുടിക്കൽ ബ്രേക്ക് എടുത്താലോ?",
        "ദാഹം വരുന്നതിന് മുമ്പ് ഒരു സിപ് കുടിക്കുന്നോ?",
        "ഉന്മേഷം ലഭിക്കാൻ ഒരു സിപ് വെള്ളം കുടിക്കാമോ?",
      ],
      reactions: [
        { kind: "thumbsup", msg: "👍 നന്നായി! നല്ല ശീലം!" },
        { kind: "happy", msg: "💧 ഫ്രഷ് ആയി! മുന്നോട്ട് പോകൂ!" },
        { kind: "happy", msg: "😊 സൂപ്പർ! വെള്ളം കുടി തുടരൂ!" },
        { kind: "thumbsup", msg: "✨ വളരെ നല്ലത്!" },
      ],
      hovers: [
        "വെള്ളം കുടിച്ചോ?",
        "വെള്ളം കുടി സമയം!",
        "ഒരു സിപ് എടുക്കൂ!",
        "നന്നായി മുന്നോട്ട് പോകൂ!",
      ],
      morningReminders: [
        "സുപ്രഭാതം! ഒരു ഗ്ലാസ് വെള്ളം കുടിച്ച് ദിവസം തുടങ്ങാം!",
      ],
      chayaBreakReminders: [
        "വൈകുന്നേരമായല്ലോ! ഒരു സിപ് വെള്ളം കുടിച്ചാലോ?",
      ],
      lateNightReminders: [
        "രാത്രി ഒരുപാട് വൈകിയല്ലോ! വെള്ളം കുടിച്ച് വിശ്രമിക്കൂ!",
      ],
      marathonReminders: [
        "തുടർച്ചയായി ജോലി ചെയ്യുകയാണല്ലോ! ഒരു ഗ്ലാസ് വെള്ളം കുടിക്കൂ!",
      ],
      hotWeatherReminders: [
        "നല്ല ചൂടാ ({temp}°C)! ഒരു സിപ് വെള്ളം കുടിക്കാം!",
      ],
      codingReminders: [
        "കോഡിംഗ് തിരക്കിലാണല്ലേ? ഒരു ചെറിയ സിപ് വെള്ളം!",
      ],
      videoReminders: [
        "വീഡിയോ കാണുന്നതിനൊപ്പം ഒരു സിപ് വെള്ളം?",
      ],
      breathingPrompt: "🌊 ശ്വാസം ഉള്ളിലേക്ക്... പിടിക്കുക... സാവധാനം പുറത്തേക്ക്...",
      breathingDoneMsg: "😌 ശാന്തവും ഫ്രഷുമായി! ഇനി തുടരാം!",
      weeklyReportTemplate: "📊 ആഴ്ചയിലെ റിപ്പോർട്ട്: {glasses} ഗ്ലാസ് ({ml} ml)! {goalDays} ദിവസം ലക്ഷ്യം എത്തി!",
      moodFreshReply: "🙌 കിടിലം എനർജി! നമുക്ക് ഇന്നത്തെ ദിവസം പൊളിക്കാം!",
      moodSleepyPrompt: "😴 ഉറക്കം വരുന്നോ? ഒന്ന് എഴുന്നേറ്റ് സ്ട്രെച്ച് ചെയ്ത് വെള്ളം കുടിക്കൂ!",
      moodStressedPrompt: "🌊 ടെൻഷൻ വേണ്ട! നമുക്കൊരു 1 മിനിറ്റ് ശ്വാസം വിടാം!",
      habitReminderTemplate: "⏰ ഓർമ്മപ്പെടുത്തൽ: {habit} സമയമായി!",
      habitDoneReply: "👍 വളരെ നല്ലത്! അടുത്തതിലേക്ക് പോകാം!",
      stickyNotePrefix: "📌 നിങ്ങളുടെ നോട്ട്: ",
      batteryLowTemplate: "🔌 ബാറ്ററി കുറവാണ് ({pct}%)! ചാർജർ കണക്ട് ചെയ്യൂ!",
      batteryFullTemplate: "🔋 ബാറ്ററി 100% ആയി! ഇനി ചാർജർ ഊരാം!",
      eodRecapTemplate: "🌙 ഇന്നത്തെ ദിവസം സൂപ്പർ! {glasses} • 💼 {workTime} • ☕ {breakTime} • 🔥 {streak}d!",
      bedtimeTemplate: "🌙 സമയം {time} ആയി! ഇനി ഉറങ്ങാൻ സമയമായി!",
      workStartReply: "💪 വർക്ക് സെഷൻ തുടങ്ങി! നന്നായി ഫോക്കസ് ചെയ്യൂ!",
      breakStartReply: "☕ ബ്രേക്ക് ടൈം! ഒന്ന് റിലാക്സ് ചെയ്യൂ!",
      workEndReply: "🌙 വർക്ക് സെഷൻ കഴിഞ്ഞു! ഇന്ന് നന്നായി ചെയ്തു!",
      scheduledBreakStartTemplate: "🍽 {title} സമയമായി ({start}–{end})!",
      scheduledBreakEndTemplate: "⏰ {title} കഴിഞ്ഞു! തിരിച്ച് വർക്കിലേക്ക് വരാം?",
      specialWishes: {
        birthday: "🎂 ഹാപ്പി ബർത്ത്ഡേ {name}!! നല്ലൊരു വർഷം ആശംസിക്കുന്നു!",
        new_year: "🎆 ഹാപ്പി ന്യൂ ഇയർ!",
        vishu: "🌼 ഹാപ്പി വിഷു!",
        independence_day: "🇮🇳 ഹാപ്പി ഇൻഡിപെൻഡൻസ് ഡേ!",
        republic_day: "🇮🇳 ഹാപ്പി റിപ്പബ്ലിക് ഡേ!",
        kerala_piravi: "🌴 കേരളപ്പിറവി ആശംസകൾ!",
        christmas: "🎄 മെറി ക്രിസ്മസ്!",
      },
      poseLines: [
        { kind: "thumbsup", msg: "👍 വെള്ളം കുടിച്ച് ഉന്മേഷത്തോടെ ഇരിക്കൂ!" },
        { kind: "happy", msg: "😊 നന്നായി മുന്നോട്ട് പോകൂ!" },
      ],
    },
    english: {
      title: "Time to Hydrate",
      peek: "Water?",
      drinking: "💧 Sipping...",
      nudge: "Quick sip check?",
      snooze: "Got it, back soon!",
      laterLabel: "Later ▾",
      laterDoubtLabel: "Reply ▾",
      laterAngryLabel: "Wait ▾",
      focusPeekWater: "Busy? 💧",
      focusPeekBreak: "Break? 👀",
      replyLines: {
        snooze5: "👍 Sure — back in 5m!",
        snooze15: "👌 Finish up! Back in 15m.",
        snooze30: "✨ Quiet for 30m — focus on!",
        deepFocus: "🔥 Staying out of your way for 20m!",
        justHad: "💧 Awesome! Logged that sip 👍",
        alreadyRested: "✨ Great — break counted!",
        skipBreak: "👌 Skipped for now!",
      },
      refuse1: "😅 Cool, see you soon!",
      refuse2Title: "😕 Sure?",
      refuse2Quote: "Skip water right now?",
      refuse3Title: "😤 Quick Sip!",
      refuse3Quote: "Hydration check — just one sip!",
      dismiss: "See you shortly!",
      milestone50: "Halfway there today!",
      milestone100: "Daily hydration goal done!",
      eyeBreak: "Look 20ft away for 20s.",
      eyeBreakPrompt: "Rest your eyes for 20s?",
      stretchPrompt: "Quick stretch for your back?",
      standBreakPrompt: "🚶 {mins}m active — {dur} walk?",
      pomodoroBreakPrompt: "25m Focus session done! Ready for a 5-minute break?",
      pomodoroWorkPrompt: "Break is done! Ready to start the next 25m focus session?",
      systemHighLoadPrompt: "System load is high! How about a quick breather?",
      systemLongActivePrompt: "You've been active for 90+ minutes! Ready for a quick stretch & sip?",
      starvePrompt: "I'm feeling tired waiting for water... could we take a quick sip?",
      breakDoneMsg: "✨ Break complete! Feeling refreshed!",
      welcomeTemplate: "👋 Hi {name}, how are you? Wishing you a great day ahead!",
      welcomeReply: "😊 Awesome! I'll remind you when it's time for water!",
      pillNormal: "💧 Drink!",
      pillDue: "💧 Drink!",
      pillDoubt: "😕 Sure?",
      pillAngry: "😠 DRINK IT!",
      pillPaused: "⏸ Paused",
      pillDnd: "🌙 DND",
      reminders: [
        "Ready for a quick glass of water?",
        "How about a quick hydration break?",
        "Want to grab a refreshing sip of water?",
        "Have you had a sip of water recently?",
        "Shall we take a quick water break to stay focused?",
      ],
      reactions: [
        { kind: "thumbsup", msg: "👍 Great job!" },
        { kind: "celebrate", msg: "💧 Refreshing! Keep it up!" },
        { kind: "happy", msg: "😊 Awesome! Stay hydrated!" },
        { kind: "thumbsup", msg: "✨ Nice habit!" },
      ],
      hovers: [
        "Had water yet?",
        "Stay hydrated!",
        "Quick sip check!",
        "Doing great!",
      ],
      morningReminders: [
        "Good morning! Start your day with a refreshing glass of water!",
      ],
      chayaBreakReminders: [
        "Afternoon break time! Ready for a quick glass of water?",
      ],
      lateNightReminders: [
        "Working late tonight? Take a sip of water and get some rest soon!",
      ],
      marathonReminders: [
        "Long continuous work session! Time for an extra sip of water!",
      ],
      hotWeatherReminders: [
        "Warm weather ({temp}°C) — grab a cool sip of water!",
      ],
      codingReminders: [
        "Deep in code — take a quick hydration sip!",
      ],
      videoReminders: [
        "Enjoying the video? Quick sip of water!",
      ],
      breathingPrompt: "🌊 Follow the glowing ring — inhale deeply, hold, and exhale calmly...",
      breathingDoneMsg: "😌 Calm and refreshed! Ready to continue!",
      weeklyReportTemplate: "📊 Weekly Summary: {glasses} glasses ({ml} ml) & {goalDays} goal days!",
      moodFreshReply: "🙌 Great energy! Let's make today awesome!",
      moodSleepyPrompt: "😴 Feeling sleepy? Stretch and grab a glass of water!",
      moodStressedPrompt: "🌊 Slow down — let's do a quick 1-minute calm breathing exercise!",
      habitReminderTemplate: "⏰ Quick reminder: Time for {habit}!",
      habitDoneReply: "👍 Awesome! Checked off!",
      stickyNotePrefix: "📌 Your Note: ",
      batteryLowTemplate: "🔌 Battery is low ({pct}%)! Plug in your charger soon!",
      batteryFullTemplate: "🔋 Battery reached 100%! You can unplug the charger!",
      eodRecapTemplate: "🌙 Great work today! {glasses} • 💼 {workTime} • ☕ {breakTime} • 🔥 {streak}d!",
      bedtimeTemplate: "🌙 It's {time} already! Wind down and get some sleep!",
      workStartReply: "💪 Work timer started! Let's stay focused!",
      breakStartReply: "☕ Break mode on! Step away and recharge!",
      workEndReply: "🌙 Work session ended! Great job today!",
      scheduledBreakStartTemplate: "🍽 Time for {title} ({start}–{end})!",
      scheduledBreakEndTemplate: "⏰ {title} ended! Ready to resume work?",
      specialWishes: {
        birthday: "🎂 Happy Birthday {name}!! Wishing you a wonderful year ahead!",
        new_year: "🎆 Happy New Year!",
        vishu: "🌼 Happy Vishu!",
        independence_day: "🇮🇳 Happy Independence Day!",
        republic_day: "🇮🇳 Happy Republic Day!",
        kerala_piravi: "🌴 Happy Kerala Piravi!",
        christmas: "🎄 Merry Christmas!",
      },
      poseLines: [
        { kind: "thumbsup", msg: "👍 Stay hydrated and energized!" },
        { kind: "happy", msg: "😊 Doing great today!" },
      ],
    },
  },
};

function normalizeLanguage(lang) {
  return String(lang || "").trim().toLowerCase() === "english" ? "english" : "malayalam";
}

function isMohanlalCharacter(glbPath) {
  const raw = String(glbPath || "").trim().toLowerCase();
  if (!raw) return true; // legacy default empty key maps to Mohanlal
  if (raw === "droppy") return false;
  const base = path.basename(raw, path.extname(raw));
  return base === "mohanlal" || base.startsWith("mohanlal_") || base.startsWith("mohanlal-");
}

function loadSidecarDialogs(resolvedGlbFile) {
  if (!resolvedGlbFile) return null;
  try {
    const ext = path.extname(resolvedGlbFile);
    const sidecar = resolvedGlbFile.slice(0, resolvedGlbFile.length - ext.length) + ".dialogs.json";
    if (!fs.existsSync(sidecar)) return null;
    const raw = fs.readFileSync(sidecar, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function adaptDialogForGender(text, userGender = "male") {
  const s = String(text || "");
  if (String(userGender || "").trim().toLowerCase() !== "female") {
    return s;
  }
  return s
    .replace(/നീ പോ മോനേ ദിനേശാ/g, "നീ പോ മോളേ")
    .replace(/ഡാ\s+മോനേ/g, "മോളേ")
    .replace(/ഡാ കുട്ടാ/g, "മോളേ കുട്ടീ")
    .replace(/കുട്ടാ/g, "കുട്ടീ")
    .replace(/ചുണക്കുട്ടൻ/g, "ചുണക്കുട്ടി")
    .replace(/മോനും/g, "മോളും")
    .replace(/മോനേ/g, "മോളേ")
    .replace(/മോനെ/g, "മോളെ")
    .replace(/ഡാ(?=[,\s!?\.]|$)/g, "മോളേ")
    .replace(/ില്ലേടാ/g, "ില്ലേ മോളേ");
}

function getDialogPack(glbConfigValue, language, resolvedGlbFile = "", userGender = "male") {
  const lang = normalizeLanguage(language);
  const packKey = isMohanlalCharacter(glbConfigValue) ? "mohanlal" : "default";
  const base = BUILTIN_PACKS[packKey][lang];
  const merged = {
    ...base,
    reminders: [...base.reminders],
    reactions: base.reactions.map((r) => ({ ...r })),
    hovers: [...base.hovers],
    morningReminders: Array.isArray(base.morningReminders) ? [...base.morningReminders] : [],
    chayaBreakReminders: Array.isArray(base.chayaBreakReminders) ? [...base.chayaBreakReminders] : [],
    lateNightReminders: Array.isArray(base.lateNightReminders) ? [...base.lateNightReminders] : [],
    marathonReminders: Array.isArray(base.marathonReminders) ? [...base.marathonReminders] : [],
    hotWeatherReminders: Array.isArray(base.hotWeatherReminders) ? [...base.hotWeatherReminders] : [],
    codingReminders: Array.isArray(base.codingReminders) ? [...base.codingReminders] : [],
    videoReminders: Array.isArray(base.videoReminders) ? [...base.videoReminders] : [],
    poseLines: Array.isArray(base.poseLines) ? base.poseLines.map((p) => ({ ...p })) : [],
  };

  const sidecar = loadSidecarDialogs(resolvedGlbFile);
  if (sidecar) {
    const langLayer =
      (sidecar[lang] && typeof sidecar[lang] === "object" ? sidecar[lang] : null) ||
      (sidecar.default && typeof sidecar.default === "object" ? sidecar.default : null) ||
      sidecar;
    for (const strKey of [
      "title",
      "peek",
      "drinking",
      "nudge",
      "snooze",
      "laterLabel",
      "laterDoubtLabel",
      "laterAngryLabel",
      "focusPeekWater",
      "focusPeekBreak",
      "refuse1",
      "refuse2Title",
      "refuse2Quote",
      "refuse3Title",
      "refuse3Quote",
      "dismiss",
      "milestone50",
      "milestone100",
      "eyeBreak",
      "eyeBreakPrompt",
      "stretchPrompt",
      "standBreakPrompt",
      "pomodoroBreakPrompt",
      "pomodoroWorkPrompt",
      "systemHighLoadPrompt",
      "systemLongActivePrompt",
      "starvePrompt",
      "breakDoneMsg",
      "welcomeTemplate",
      "welcomeReply",
      "breathingPrompt",
      "breathingDoneMsg",
      "weeklyReportTemplate",
      "moodFreshReply",
      "moodSleepyPrompt",
      "moodStressedPrompt",
      "habitReminderTemplate",
      "habitDoneReply",
      "stickyNotePrefix",
      "batteryLowTemplate",
      "batteryFullTemplate",
      "eodRecapTemplate",
      "bedtimeTemplate",
      "workStartReply",
      "breakStartReply",
      "workEndReply",
      "scheduledBreakStartTemplate",
      "scheduledBreakEndTemplate",
      "pillNormal",
      "pillDue",
      "pillDoubt",
      "pillAngry",
      "pillPaused",
      "pillDnd",
    ]) {
      if (typeof langLayer[strKey] === "string" && langLayer[strKey].trim()) {
        merged[strKey] = langLayer[strKey].trim();
      }
    }
    if (langLayer.replyLines && typeof langLayer.replyLines === "object") {
      merged.replyLines = { ...(merged.replyLines || {}), ...langLayer.replyLines };
    }
    if (langLayer.specialWishes && typeof langLayer.specialWishes === "object") {
      merged.specialWishes = { ...(merged.specialWishes || {}), ...langLayer.specialWishes };
    }
    for (const arrKey of [
      "reminders",
      "hovers",
      "morningReminders",
      "chayaBreakReminders",
      "lateNightReminders",
      "marathonReminders",
      "hotWeatherReminders",
      "codingReminders",
      "videoReminders",
    ]) {
      if (Array.isArray(langLayer[arrKey]) && langLayer[arrKey].length > 0) {
        const cleanedArr = langLayer[arrKey].filter((x) => typeof x === "string" && x.trim());
        if (cleanedArr.length > 0) merged[arrKey] = cleanedArr;
      }
    }
    if (Array.isArray(langLayer.reactions) && langLayer.reactions.length > 0) {
      const cleaned = langLayer.reactions
        .filter((r) => r && typeof r.msg === "string" && r.msg.trim())
        .map((r) => ({
          kind: ["thumbsup", "celebrate", "happy", "salute"].includes(r.kind) ? r.kind : "thumbsup",
          msg: r.msg.trim(),
        }));
      if (cleaned.length > 0) merged.reactions = cleaned;
    }
    if (Array.isArray(langLayer.poseLines) && langLayer.poseLines.length > 0) {
      const cleanedPose = langLayer.poseLines
        .filter((r) => r && typeof r.msg === "string" && r.msg.trim())
        .map((r) => ({
          kind: ["thumbsup", "celebrate", "happy", "salute", "meesha"].includes(r.kind) ? r.kind : "thumbsup",
          msg: r.msg.trim(),
        }));
      if (cleanedPose.length > 0) merged.poseLines = cleanedPose;
    }
  }

  if (String(userGender || "").trim().toLowerCase() === "female") {
    for (const k of Object.keys(merged)) {
      if (typeof merged[k] === "string") {
        merged[k] = adaptDialogForGender(merged[k], "female");
      } else if (Array.isArray(merged[k])) {
        merged[k] = merged[k].map((item) => {
          if (typeof item === "string") return adaptDialogForGender(item, "female");
          if (item && typeof item === "object" && typeof item.msg === "string") {
            return { ...item, msg: adaptDialogForGender(item.msg, "female") };
          }
          return item;
        });
      } else if (merged[k] && typeof merged[k] === "object") {
        const adaptedObj = {};
        for (const [subK, subV] of Object.entries(merged[k])) {
          adaptedObj[subK] = typeof subV === "string" ? adaptDialogForGender(subV, "female") : subV;
        }
        merged[k] = adaptedObj;
      }
    }
  }
  return merged;
}

function getTimeOfDayContext(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  const h = d.getHours();
  const m = d.getMinutes();
  if ((h === 23 && m >= 30) || h < 5) {
    return "late_night";
  }
  if (h >= 6 && h < 10) {
    return "morning";
  }
  if ((h === 15 && m >= 30) || h === 16 || (h === 17 && m <= 30)) {
    return "chaya_break";
  }
  return "normal";
}

function pickContextualReminderQuote(pack, opts = {}) {
  if (!pack || typeof pack !== "object") return "Time for a quick sip?";
  const activeMins = Number(opts.continuousActiveMinutes) || 0;
  const tempC = Number(opts.weatherTempC);
  const appCat = String(opts.appCategory || "other");
  const rng = typeof opts.rng === "function" ? opts.rng : Math.random;
  if (activeMins >= 60 && Array.isArray(pack.marathonReminders) && pack.marathonReminders.length > 0) {
    return pack.marathonReminders[Math.floor(rng() * pack.marathonReminders.length)];
  }
  if (
    Number.isFinite(tempC) &&
    tempC >= 31 &&
    Array.isArray(pack.hotWeatherReminders) &&
    pack.hotWeatherReminders.length > 0 &&
    rng() < 0.45
  ) {
    const raw = pack.hotWeatherReminders[Math.floor(rng() * pack.hotWeatherReminders.length)];
    return raw.replace(/\{temp\}/g, String(Math.round(tempC)));
  }
  if (appCat === "coding" && Array.isArray(pack.codingReminders) && pack.codingReminders.length > 0 && rng() < 0.5) {
    return pack.codingReminders[Math.floor(rng() * pack.codingReminders.length)];
  }
  if (appCat === "video" && Array.isArray(pack.videoReminders) && pack.videoReminders.length > 0 && rng() < 0.5) {
    return pack.videoReminders[Math.floor(rng() * pack.videoReminders.length)];
  }
  const tod = getTimeOfDayContext(opts.now || new Date());
  if (tod === "late_night" && Array.isArray(pack.lateNightReminders) && pack.lateNightReminders.length > 0) {
    return pack.lateNightReminders[Math.floor(rng() * pack.lateNightReminders.length)];
  }
  if (tod === "morning" && Array.isArray(pack.morningReminders) && pack.morningReminders.length > 0) {
    const raw = pack.morningReminders[Math.floor(rng() * pack.morningReminders.length)];
    return Number.isFinite(tempC)
      ? raw.replace(/\{temp\}/g, String(Math.round(tempC)))
      : raw.replace(/\s*\{temp\}°?C?/g, "");
  }
  if (tod === "chaya_break" && Array.isArray(pack.chayaBreakReminders) && pack.chayaBreakReminders.length > 0) {
    return pack.chayaBreakReminders[Math.floor(rng() * pack.chayaBreakReminders.length)];
  }
  const list = Array.isArray(pack.reminders) && pack.reminders.length > 0 ? pack.reminders : ["Time for a quick sip?"];
  return list[Math.floor(rng() * list.length)];
}

function formatWeeklyReportMessage(pack, summary = {}) {
  const tpl =
    (pack && typeof pack.weeklyReportTemplate === "string" && pack.weeklyReportTemplate) ||
    "📊 Weekly Summary: {glasses} glasses ({ml} ml)!";
  return tpl
    .replace(/\{glasses\}/g, String(summary.totalGlasses || 0))
    .replace(/\{ml\}/g, String((summary.totalMl || 0).toLocaleString()))
    .replace(/\{goalDays\}/g, String(summary.goalsHitDays || 0));
}

function computeEffectiveIntervalMinutes(baseIntervalMinutes, continuousActiveMinutes = 0) {
  const base = Math.max(1, Math.round(Number(baseIntervalMinutes) || 20));
  const activeMins = Number(continuousActiveMinutes) || 0;
  if (activeMins >= 60 && base > 5) {
    return Math.max(5, Math.round(base * 0.8));
  }
  return base;
}

function formatDisplayUsername(rawName = "") {
  const cleaned = String(rawName || "")
    .trim()
    .replace(/[._-]+/g, " ")
    .trim();
  if (!cleaned) return "Friend";
  return cleaned
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function buildWelcomeGreeting(pack, rawUsername = "") {
  const name = formatDisplayUsername(rawUsername);
  const tpl =
    (pack && typeof pack.welcomeTemplate === "string" && pack.welcomeTemplate) ||
    "👋 Hi {name}, how are you?";
  return tpl.replace(/\{name\}/g, name);
}

module.exports = {
  BUILTIN_PACKS,
  normalizeLanguage,
  isMohanlalCharacter,
  adaptDialogForGender,
  getDialogPack,
  getTimeOfDayContext,
  pickContextualReminderQuote,
  computeEffectiveIntervalMinutes,
  formatDisplayUsername,
  buildWelcomeGreeting,
  formatWeeklyReportMessage,
};

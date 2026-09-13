import type { Tone } from "../products";

export type CategoryPack = {
  visualWorld: string;
  proof: string;
  cta: string;
  hookLine: Record<Tone, string>;
  bodyBeats: [string, string, string];
};

const homeCta = "Call or tap to book. Same-day answers.";
const healthCta = "New patients welcome. Call or tap to book.";
const shopCta = "Stop in or order ahead. See you soon.";

/** Editable per-category packs. Unknown ids fall back to `general_contractor`. */
export const CATEGORY_PACKS: Record<string, CategoryPack> = {
  hvac: {
    visualWorld:
      "Talking-head in the driveway: technician in a branded shirt next to a clean service van, suburban house, palm or shade trees, hot-day exteriors. Real condensers and thermostats only as cutaways.",
    proof: "Licensed, local, and used to the heat. Show real equipment and real houses.",
    cta: "Call for same-day service. Cooling and heating, done right.",
    hookLine: {
      energetic: "Hi folks — when the AC dies, you shouldn't have to wait.",
      trustworthy: "Hi folks, this is your local crew. If the AC is out, we'll say when we can be there — and be there.",
      premium: "Quiet rooms. Steady air. A system that just works.",
      friendly: "Too hot in the house? We can fix that today.",
    },
    bodyBeats: [
      "The problem: a hot house, a clicking unit, a thermostat that lies.",
      "The work: a tech on site, gauges on the lines, a unit running clean.",
      "The neighborhood: this is a local crew, not a national call center.",
    ],
  },
  plumbing: {
    visualWorld:
      "Kitchens, bathrooms, water heaters, clean copper and PEX, a tech under a sink, dry floors after the job.",
    proof: "Show the leak, then the fix. No dirty-job gore — keep it tidy.",
    cta: "Call for a plumber who shows up. Leaks don't wait.",
    hookLine: {
      energetic: "That drip is not going to fix itself.",
      trustworthy: "A leak today is a ceiling tomorrow. We'll take a look.",
      premium: "Quiet pipes. Clean finishes. Work you don't have to think about.",
      friendly: "If the sink's fighting you, we can take it from here.",
    },
    bodyBeats: [
      "Name the mess: slow drain, running toilet, no hot water.",
      "Show the fix with customer's photos of the space if they exist.",
      "Leave it cleaner than we found it. Local and on the calendar.",
    ],
  },
  electrical: {
    visualWorld:
      "Panels, outlets, recessed lights, a clean garage panel upgrade, testers, a tech with a headlamp.",
    proof: "Safety and code without lecturing. Licensed work.",
    cta: "Call for a licensed electrician. Same-week panels, same-day outages.",
    hookLine: {
      energetic: "Breakers tripping? Let's put the lights back on.",
      trustworthy: "If it sparks, flickers, or trips — don't wait it out.",
      premium: "Hidden work, finished rooms. Power that stays put.",
      friendly: "Flickering lights? We'll come figure it out.",
    },
    bodyBeats: [
      "The symptom: flicker, dead outlet, hot breaker.",
      "The work: panel, wiring, fixtures — match the customer's photos.",
      "A local license on the truck, not a flyer from three cities over.",
    ],
  },
  roofing: {
    visualWorld:
      "Architectural shingles, clean eaves, a crew on a sunlit roof, before/after of a house elevation, storm sky if relevant.",
    proof: "The roof is the product. Show the house, the ridge, the finished line.",
    cta: "Free roof check. Call before the next storm.",
    hookLine: {
      energetic: "Your roof is the only thing between you and the weather.",
      trustworthy: "We'll tell you if you need a repair or a roof. Not an upsell.",
      premium: "A finished roof should disappear. Until it rains.",
      friendly: "Curious about that stain on the ceiling? We'll take a look.",
    },
    bodyBeats: [
      "The house as the hero — customer's exterior photos first.",
      "The work: shingles, flashing, a clean ridge line.",
      "Local crew, local warranty, a number you can actually call.",
    ],
  },
  general_contractor: {
    visualWorld:
      "Jobsite in a lived-in home, dust walls vs finished rooms, tools laid out, a walkthrough of the space.",
    proof: "Process and finish quality. Before/after if photos allow.",
    cta: "Call for a walkthrough. We'll tell you what it actually takes.",
    hookLine: {
      energetic: "The house you have can become the house you want.",
      trustworthy: "We finish the jobs we start. Ask the last block we worked on.",
      premium: "Restraint, materials, and a calendar that holds.",
      friendly: "Thinking about a remodel? Let's walk the rooms together.",
    },
    bodyBeats: [
      "The rooms as they are, using customer photos.",
      "The work: framing, finishes, a detail that shows care.",
      "A local builder, not a revolving sub list.",
    ],
  },
  garage_door: {
    visualWorld:
      "Curb view of a closed door, a smooth open, torsion springs, a clean garage interior.",
    proof: "Quiet, straight, and on the house. Safety sensors matter.",
    cta: "Same-week installs. Call if it won't close.",
    hookLine: {
      energetic: "If the door slams or stalls, don't wait for it to fail at 11pm.",
      trustworthy: "We'll say if it's a spring, a motor, or a new door.",
      premium: "A door that disappears into the house. Quiet, straight, done.",
      friendly: "Stuck garage door? We do this all week.",
    },
    bodyBeats: [
      "Curb appeal: the door is half the face of the house.",
      "The mechanism: smooth travel, no slam.",
      "Local install, local service after.",
    ],
  },
  pest_control: {
    visualWorld:
      "Exterior foundation, kitchen baseboards, a tech in a clean polo, no close-up insects. Homes, not horror.",
    proof: "Prevention and follow-up, not scare tactics.",
    cta: "Book a visit. We'll treat and come back if they do.",
    hookLine: {
      energetic: "Don't share the kitchen. We'll take the pests.",
      trustworthy: "A plan, a treat, a follow-up. No scare video.",
      premium: "Quiet protection. You shouldn't have to think about it.",
      friendly: "Saw something you didn't invite? We can help.",
    },
    bodyBeats: [
      "The house, not the bug. Keep it livable.",
      "A technician who explains what they're doing.",
      "Local routes, not a national script.",
    ],
  },
  landscaping: {
    visualWorld:
      "Front yard, mow lines, drought-smart beds, a crew that leaves edges sharp, golden-hour curb.",
    proof: "The yard after the truck leaves. Edges, mulch, light.",
    cta: "Ask for a yard walk. We'll quote what you actually see.",
    hookLine: {
      energetic: "Your curb is the first thing they notice. Let's make it count.",
      trustworthy: "Same crew, same week. The yard stays ahead of the season.",
      premium: "Planting with a point of view. Not a catalog dump.",
      friendly: "Tired of the weekend mow? We can take the yard.",
    },
    bodyBeats: [
      "Before: the actual yard from customer photos.",
      "After energy: line, color, shade.",
      "A local crew that knows this climate.",
    ],
  },
  tree_service: {
    visualWorld:
      "Mature trees, clean cuts, a chipper at the curb, crews in PPE, sky through a thinned canopy.",
    proof: "Safety and the tree still standing healthier. No cowboy climbing shots.",
    cta: "Call before monsoon or freeze. We'll look at the limbs that matter.",
    hookLine: {
      energetic: "That limb over the roof isn't going to get lighter.",
      trustworthy: "We'll tell you what to take, what to leave, and why.",
      premium: "Care for the tree, care for the house it shades.",
      friendly: "Big tree, small lot? We'll come look with you.",
    },
    bodyBeats: [
      "The tree and the house in one frame.",
      "Clean work: cuts, haul-away, a yard you can walk.",
      "Insured, local, not a door-hanger after a storm.",
    ],
  },
  cleaning: {
    visualWorld:
      "Kitchens, bathrooms, sunlight on a counter, a made bed, a team in simple uniforms. Lived-in homes, not showrooms.",
    proof: "Recurring care. The house on a Tuesday, not a staging.",
    cta: "Book a first clean. Keep the ones after if it fits.",
    hookLine: {
      energetic: "Get your Saturday back. We'll take the house.",
      trustworthy: "Same people, same checklist, every visit.",
      premium: "A home that feels looked after. Quietly.",
      friendly: "Life is a lot. We can handle the floors and the sinks.",
    },
    bodyBeats: [
      "Real rooms from the photos — not stock sparkle.",
      "The work: counters, glass, floors.",
      "A local team with a name you can ask for.",
    ],
  },
  painting: {
    visualWorld:
      "Cut-in lines, a freshly rolled wall, tape pulled clean, exterior stucco in even light.",
    proof: "Edges and coverage. The reveal of a finished room.",
    cta: "Ask for a color walk. We'll quote the rooms, not a mystery number.",
    hookLine: {
      energetic: "One weekend of paint can change the whole house.",
      trustworthy: "Prep is the job. The color is the easy part.",
      premium: "Even walls. Honest color. Work that disappears.",
      friendly: "Ready for a new color? We'll protect the floors and do it right.",
    },
    bodyBeats: [
      "The rooms as they are.",
      "Prep and the finished edge.",
      "Local painters, not a crew that vanishes after the check.",
    ],
  },
  flooring: {
    visualWorld:
      "Plank floors, grout lines, a transition at a doorway, a roll of LVP, bare feet on a finished room.",
    proof: "The floor as a surface you live on. Tight seams.",
    cta: "Come see samples, or we'll bring them. Call to schedule.",
    hookLine: {
      energetic: "The floor is the biggest surface in the house. Make it count.",
      trustworthy: "We'll tell you what holds up with kids, dogs, and this climate.",
      premium: "Quiet underfoot. Lines that run true.",
      friendly: "Tired of the carpet? Let's walk some samples.",
    },
    bodyBeats: [
      "Existing floors from customer photos.",
      "Install detail: seams, base, transitions.",
      "Local shop, local warranty.",
    ],
  },
  windows_doors: {
    visualWorld:
      "A new slider to the yard, even interior light, a front door that fits the house, condensation-free glass.",
    proof: "Light, seal, and the look from the curb.",
    cta: "Book a measure. We'll quote what actually fits.",
    hookLine: {
      energetic: "Better glass, quieter rooms, lower bills.",
      trustworthy: "Measure twice. Install once. We'll be here after.",
      premium: "Light, lines, and a door that belongs on the house.",
      friendly: "Drafty windows? Let's take a look together.",
    },
    bodyBeats: [
      "The elevations and interiors from photos.",
      "The new unit in the opening, trim finished.",
      "A local installer, not a national boiler room.",
    ],
  },
  solar: {
    visualWorld:
      "Roof arrays in clean rows, a utility meter, a tablet with production, a house that still looks like a house.",
    proof: "Production and a roof that still looks finished. No hype kWh numbers unless the brief has them.",
    cta: "Ask for a roof look. We'll run your numbers, not a script.",
    hookLine: {
      energetic: "Your roof is already sitting in the sun. Put it to work.",
      trustworthy: "We'll show the math. If it doesn't pencil, we'll say so.",
      premium: "Power, quietly. The house stays the house.",
      friendly: "Curious about solar? We'll walk the roof and the bill with you.",
    },
    bodyBeats: [
      "The house and roof from customer photos.",
      "A clean array, not a collage of stock panels.",
      "Local aftercare — who do you call in year three?",
    ],
  },
  pool_spa: {
    visualWorld:
      "Water, tile, a clean deck, evening lights, a service tech testing, desert backyard living.",
    proof: "Clear water and a deck you can walk barefoot.",
    cta: "Weekly service or a one-time rescue. Call and we'll slot you.",
    hookLine: {
      energetic: "The pool should be the best part of the yard, not a chore.",
      trustworthy: "Chemistry, equipment, and a tech who shows up on the route day.",
      premium: "Water like glass. Equipment you don't hear.",
      friendly: "Green water? We'll get it swimmable.",
    },
    bodyBeats: [
      "The actual backyard from photos.",
      "Service in progress — testing, brushing, a clean waterline.",
      "A local route, not a call center.",
    ],
  },
  auto_repair: {
    visualWorld:
      "A clean bay, a car on the lift, a tech with a scan tool, a waiting area that isn't grim, the customer's vehicle if photographed.",
    proof: "Explain the repair. Show the shop, not a montage of wrenches.",
    cta: "Book a drop-off. We'll call before we do extra work.",
    hookLine: {
      energetic: "That noise isn't going to get quieter. Bring it in.",
      trustworthy: "We'll show you the part. Then we'll fix it.",
      premium: "Diagnostics first. No parts theater.",
      friendly: "Check-engine light? We'll read it and talk it through.",
    },
    bodyBeats: [
      "The shop and the kind of cars they actually do.",
      "The work: inspection, the repair, the road test.",
      "A name on the building, a number that picks up.",
    ],
  },
  auto_body: {
    visualWorld:
      "A car in even shop light, paint blend, a dent disappearing, a finished panel next to an untouched one.",
    proof: "The blend. Insurance-friendly without making it about insurance.",
    cta: "Send a photo or bring it by. We'll quote the panel, not a scare.",
    hookLine: {
      energetic: "The dent doesn't have to live there.",
      trustworthy: "We'll match the paint. You'll have to look to find the work.",
      premium: "Factory lines. Honest blend. No orange peel.",
      friendly: "Fender bender? We'll get it looking like itself again.",
    },
    bodyBeats: [
      "The vehicle as it is — customer photos.",
      "Bodywork and paint in progress, then the reveal.",
      "Local shop, rental help if they offer it.",
    ],
  },
  dental: {
    visualWorld:
      "A calm operatory, natural light, a dentist talking at eye level, no drills-in-mouth shots, a front desk that feels human.",
    proof: "Comfort and clarity. New-patient ease.",
    cta: "New patients welcome. Call or tap to book.",
    hookLine: {
      energetic: "A cleaner, brighter visit than the one you're imagining.",
      trustworthy: "We'll tell you what you need, and what you don't.",
      premium: "Unhurried care. A room you'd actually sit in.",
      friendly: "Nervous at the dentist? That's most of us. We'll go slow.",
    },
    bodyBeats: [
      "The studio from photos — wood, light, people.",
      "A simple care moment, never gore.",
      "A neighborhood practice, not a chain script.",
    ],
  },
  chiropractic: {
    visualWorld:
      "Treatment tables, movement, a practitioner talking, patients in motion (walking, desks), no cracking close-ups.",
    proof: "Relief and function. Everyday bodies.",
    cta: healthCta,
    hookLine: {
      energetic: "Your back has been trying to tell you. Let's listen.",
      trustworthy: "A plan for the pain, not a lifetime of mystery visits.",
      premium: "Measured care. You should leave moving better.",
      friendly: "Desk back? We'll take a look and keep it simple.",
    },
    bodyBeats: [
      "The office as a place you'd return to.",
      "Movement, not medical theater.",
      "Local, known, easy to book.",
    ],
  },
  medical_clinic: {
    visualWorld:
      "A clean waiting room, a clinician in conversation, a neighborhood clinic exterior, no procedure footage.",
    proof: "Access and follow-through. Same-week appointments if the brief says so.",
    cta: healthCta,
    hookLine: {
      energetic: "Care that fits around the week you actually have.",
      trustworthy: "We'll see you, hear you, and explain the next step.",
      premium: "Unrushed visits. A clinic that still knows your name.",
      friendly: "Need a doctor who picks up? That's us.",
    },
    bodyBeats: [
      "The clinic from the outside in, using photos.",
      "A conversation, not a procedure.",
      "Neighborhood care, not a billboard mill.",
    ],
  },
  veterinary: {
    visualWorld:
      "Pets with their people, a calm exam room, a tech who kneels, no distress shots, the front desk with treats.",
    proof: "Kindness and competence. The animal is the client.",
    cta: "New patients welcome. Call to set a visit.",
    hookLine: {
      energetic: "They can't tell you it hurts. We can help anyway.",
      trustworthy: "Honest medicine for the animal you love.",
      premium: "Quiet rooms. Careful hands. Medicine with manners.",
      friendly: "New in town, or new pup? We'll take good care.",
    },
    bodyBeats: [
      "Real pets from customer photos if present — otherwise the clinic.",
      "A gentle exam, a clear plan.",
      "A local practice, not a revolving ER.",
    ],
  },
  law_firm: {
    visualWorld:
      "A real office, a conversation at a table, neighborhood context, no gavel stock, no marble palace unless the photos are that.",
    proof: "Clarity and availability. Who picks up the phone.",
    cta: "Call for a consult. We'll tell you if we can help.",
    hookLine: {
      energetic: "Don't wait for the letter to get worse. Talk to someone.",
      trustworthy: "Plain advice. A plan. A number that answers.",
      premium: "Discreet, prepared, and on your side of the table.",
      friendly: "Legal stuff is heavy. We'll walk it with you.",
    },
    bodyBeats: [
      "The people and the office from photos.",
      "A consult energy — listening, notes, next step.",
      "Local counsel, not a billboard 1-800.",
    ],
  },
  insurance: {
    visualWorld:
      "A storefront, a conversation, a family or small business context matching the photos, no exploding-car stock.",
    proof: "Someone local when something happens.",
    cta: "Ask for a policy check. Fifteen minutes, no lecture.",
    hookLine: {
      energetic: "The right policy is the one you understand.",
      trustworthy: "I'll pick up when something happens. That's the job.",
      premium: "Coverage with a name on it, not a chat bot.",
      friendly: "Let's sit down and see what you actually have.",
    },
    bodyBeats: [
      "The agent and the office.",
      "A review, a simple explanation.",
      "Local, after the claim, not just at the sale.",
    ],
  },
  real_estate: {
    visualWorld:
      "A listing's best room, a porch, a neighborhood street, an agent who looks like a person. No aerial drone unless photos include it.",
    proof: "The house and the area. Specific, not 'dream home'.",
    cta: "Tour this week. Text or call and we'll set a time.",
    hookLine: {
      energetic: "This one won't sit. Come see it this week.",
      trustworthy: "I'll tell you what the photos don't. Then we'll walk it.",
      premium: "The right house, not every house. That's the work.",
      friendly: "Looking in the neighborhood? I'll show you what's actually available.",
    },
    bodyBeats: [
      "The property from customer photos — rooms, yard, street.",
      "A detail that makes it specific (light, kitchen, porch).",
      "A local agent with a number, not a portal.",
    ],
  },
  restaurant: {
    visualWorld:
      "Plates, hands, the dining room at golden hour, a cook at the pass, the storefront at dusk. Food first.",
    proof: "The dish and the room. Steam, texture, people.",
    cta: shopCta,
    hookLine: {
      energetic: "Tonight's plate is already on the board.",
      trustworthy: "Same kitchen, same people, night after night.",
      premium: "A few things, done with care. Come sit.",
      friendly: "Hungry? We've got a table and a plate for you.",
    },
    bodyBeats: [
      "Hero dish from photos.",
      "The room and the people who work it.",
      "The block it's on — this is a neighborhood place.",
    ],
  },
  cafe: {
    visualWorld:
      "Espresso, pastry, morning window light, a counter with regulars, the sidewalk sign.",
    proof: "The drink and the habit. Daily, not a destination shoot.",
    cta: shopCta,
    hookLine: {
      energetic: "Your morning can start better than this drive-thru.",
      trustworthy: "Same baristas. Same beans. Every day of the week.",
      premium: "Quiet coffee, properly made.",
      friendly: "Come in. We'll learn your order.",
    },
    bodyBeats: [
      "The cup and the pastry.",
      "The room in the morning.",
      "A corner of this city, not a chain.",
    ],
  },
  salon: {
    visualWorld:
      "Hair texture, a chair, daylight at the window, hands cutting, a finished look. No extreme before/after unless photos are that.",
    proof: "The craft on a real person.",
    cta: "Book the chair. New guests welcome.",
    hookLine: {
      energetic: "The cut you've been screenshotting. Let's do it.",
      trustworthy: "A chair that listens before it cuts.",
      premium: "Shape, color, and time enough to do both well.",
      friendly: "Need a refresh? We'll take good care.",
    },
    bodyBeats: [
      "The space from photos.",
      "The work: cut, color, finish.",
      "A local chair with a name, not a franchise script.",
    ],
  },
  spa: {
    visualWorld:
      "Linen, quiet light, treatment rooms, stone or wood, no medicalized close-ups.",
    proof: "Atmosphere and aftercare. Rest is the product.",
    cta: "Book an hour. You'll leave different than you came.",
    hookLine: {
      energetic: "Put the week down for an hour.",
      trustworthy: "A treatment, not a pitch. We'll stay on time.",
      premium: "Silence, heat, skilled hands.",
      friendly: "You don't need an occasion. Come anyway.",
    },
    bodyBeats: [
      "The rooms as they are.",
      "A treatment in suggestion, not in graphic detail.",
      "A local place you can return to.",
    ],
  },
  gym: {
    visualWorld:
      "People moving, a floor that isn't empty, coaches who cue, daylight if it exists. No stacked-supplement montages.",
    proof: "Coaching and consistency. Real bodies.",
    cta: "Come try a class. First visit is easy to book.",
    hookLine: {
      energetic: "Show up. We'll take the hour from there.",
      trustworthy: "Coaching you can hear. A room that knows your name.",
      premium: "Training with a point. No theater.",
      friendly: "New to this? We'll start where you are.",
    },
    bodyBeats: [
      "The room and the people from photos.",
      "A class or a lift in motion.",
      "A neighborhood gym, not a 24-hour warehouse.",
    ],
  },
  daycare: {
    visualWorld:
      "Kids at play (faces okay if the customer uploaded them; otherwise hands, rooms, toys), bright rooms, a teacher at kid height. Warm, never chaotic.",
    proof: "Safety and the day's rhythm. Parents should feel the room.",
    cta: "Tour this week. We'll walk the rooms with you.",
    hookLine: {
      energetic: "A day their people will be glad they had.",
      trustworthy: "You'll know who is with them, and what the day looks like.",
      premium: "Small rooms. Attentive adults. A calm day.",
      friendly: "Looking for care that feels like a second kitchen table? Come see us.",
    },
    bodyBeats: [
      "The rooms and outdoor space from photos.",
      "A piece of the day: snack, story, play.",
      "A local place with a door you can knock on.",
    ],
  },
  moving: {
    visualWorld:
      "A truck at the curb, wrapped furniture, a crew that looks careful, a doorway, boxes labeled.",
    proof: "Care with the stuff. On-time energy without shouting.",
    cta: "Get a date on the calendar. We'll walk the house first.",
    hookLine: {
      energetic: "The move has a date. Let's make it a clean one.",
      trustworthy: "We'll wrap it, lift it, and put it where you point.",
      premium: "Careful hands. A truck that shows up when it said.",
      friendly: "Moving is a lot. We can take the heavy part.",
    },
    bodyBeats: [
      "The house and the crew.",
      "The care: pads, labels, a protected banister.",
      "Local movers, not a broker who reassigns the job.",
    ],
  },
  locksmith: {
    visualWorld:
      "A front door, a lock, a tech at dusk, a key in a calm hand. Helpful, not cinematic break-in energy.",
    proof: "Speed and no damage. 24-hour if the brief says so.",
    cta: "Locked out? Call. We'll say the arrival window.",
    hookLine: {
      energetic: "Locked out is a bad night. We can shorten it.",
      trustworthy: "We'll open it without wrecking the door. Then we'll rekey if you want.",
      premium: "Quiet entry. Hardware that belongs on the house.",
      friendly: "Keys in the car? We've got you.",
    },
    bodyBeats: [
      "The door and the hardware.",
      "A clean opening, a new key if relevant.",
      "A local number that actually answers at night.",
    ],
  },
  funeral: {
    visualWorld:
      "Soft interiors, flowers, a quiet chapel or parlor, daylight through drapes. No caskets unless the customer's photos include them. Dignity first.",
    proof: "Care for the family. Unhurried.",
    cta: "Call. We'll take the next hour with you.",
    hookLine: {
      energetic: "When it's time, you shouldn't have to figure it out alone.",
      trustworthy: "We'll walk the next decisions with you, one at a time.",
      premium: "Quiet rooms. Careful hands. A service that feels like them.",
      friendly: "You don't have to know what to ask. We'll start together.",
    },
    bodyBeats: [
      "The rooms as a place a family can sit.",
      "A detail of care — flowers, a photo table, light.",
      "A local family, not a distant brand.",
    ],
  },
  church: {
    visualWorld:
      "The sanctuary or meeting room, people (if photos allow), a door that's open, daylight, music suggested not staged.",
    proof: "Welcome. Specific times from the brief if provided.",
    cta: "You're invited this week. Times are on the end card.",
    hookLine: {
      energetic: "Come as you are. There's a seat this week.",
      trustworthy: "A church that means the welcome. See you Sunday.",
      premium: "A quiet room, a gathered people, a word that holds.",
      friendly: "New in town? Come sit with us this week.",
    },
    bodyBeats: [
      "The building and the people from photos.",
      "A piece of gathered life — singing, kids, coffee.",
      "This neighborhood, this door.",
    ],
  },
};

export function getCategoryPack(categoryId: string): CategoryPack {
  return CATEGORY_PACKS[categoryId] ?? CATEGORY_PACKS.general_contractor;
}

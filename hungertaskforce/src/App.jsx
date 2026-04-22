import { useMemo, useState } from 'react';

const PATHWAYS = [
  {
    id: 'help',
    eyebrow: 'Get help now',
    title: 'I need food',
    text: 'Find a pantry, get FoodShare guidance, or connect someone to local senior and family support.',
  },
  {
    id: 'give',
    eyebrow: 'Support locally',
    title: 'I want to give',
    text: 'Donate monthly, volunteer, or back fresh food access across Milwaukee neighborhoods.',
    href: '#monthly-giving',
  },
  {
    id: 'act',
    eyebrow: 'Move policy',
    title: 'I want to act',
    text: 'Join anti-hunger advocacy work and help protect the public programs families count on.',
    href: 'https://www.hungertaskforce.org/what-we-do/advocacy/',
  },
];

const SUPPORT_LINKS = {
  pantry: {
    title: 'Find food near you',
    text: 'Browse trusted pantry, meal site, and emergency food locations across Milwaukee County.',
    action: 'View emergency food map',
    href: 'https://www.hungertaskforce.org/get-help/emergency-food/',
  },
  foodshare: {
    title: 'Get FoodShare help',
    text: 'Connect with advocates who can help you apply for or manage FoodShare benefits.',
    action: 'Open FoodShare resources',
    href: 'https://www.hungertaskforce.org/get-help/foodshare-resources/',
  },
  seniors: {
    title: 'Support for seniors',
    text: 'Explore Stockbox, delivery support, and other food access options for older adults.',
    action: 'See senior resources',
    href: 'https://www.hungertaskforce.org/get-help/help-for-seniors/',
  },
  children: {
    title: 'Support for children',
    text: 'Learn about summer meals, WIC, school nutrition, and family food resources.',
    action: 'See children and family help',
    href: 'https://www.hungertaskforce.org/get-help/help-for-children/',
  },
  referral: {
    title: 'Talk to someone',
    text: 'Call Hunger Task Force directly for guidance if you are not sure which program fits.',
    action: 'Call 414-777-0483',
    href: 'tel:+14147770483',
  },
};

const INTAKE_STEPS = [
  {
    id: 'audience',
    question: 'Who needs help with food?',
    options: [
      { value: 'family', label: 'Myself or my family' },
      { value: 'senior', label: 'A senior I know' },
      { value: 'child', label: 'A child or student' },
    ],
  },
  {
    id: 'need',
    question: 'What kind of help are you looking for?',
    options: [
      { value: 'pantry', label: 'Find a pantry or meal site' },
      { value: 'foodshare', label: 'Apply for FoodShare' },
      { value: 'seniors', label: 'Find senior food support' },
      { value: 'children', label: 'Find help for children' },
      { value: 'referral', label: 'I am not sure yet' },
    ],
  },
];

const PROGRAMS = [
  {
    title: 'The Farm',
    text: 'Fresh produce grown for local pantries, meal programs, and shelters across the county.',
    href: 'https://www.hungertaskforce.org/what-we-do/the-farm/',
    image:
      'https://www.hungertaskforce.org/wp-content/uploads/2026/03/2026.03-silver-spring-neighborhood-center-food-pantry-5-1080x675.jpg',
  },
  {
    title: 'Mobile Market',
    text: 'A grocery store on wheels bringing fresh, affordable food directly into underserved neighborhoods.',
    href: 'https://www.hungertaskforce.org/what-we-do/mobile-market/',
    image:
      'https://www.hungertaskforce.org/wp-content/uploads/2025/02/cooking-with-culture-nutrition-education-circle.png',
  },
  {
    title: 'Advocacy',
    text: 'Policy work that protects FoodShare, school meals, WIC, and the nutrition programs families rely on.',
    href: 'https://www.hungertaskforce.org/what-we-do/advocacy/',
    image:
      'https://www.hungertaskforce.org/wp-content/uploads/2026/04/Cecelia-Gore-Friend-of-Free-Local-9x6-1-1080x675.jpg',
  },
];

const IMPACT_STATS = [
  { value: '75', label: 'pantries, meal programs, and shelters supported' },
  { value: '30M+', label: 'pounds of food distributed in a year' },
  { value: '50+', label: 'years serving Milwaukee families' },
  { value: '100%', label: 'community-supported mission' },
];

function PathwayCard({ card, onOpenHelp }) {
  if (card.id === 'help') {
    return (
      <button className="pathway-card" type="button" onClick={onOpenHelp}>
        <span className="pathway-eyebrow">{card.eyebrow}</span>
        <h3>{card.title}</h3>
        <p>{card.text}</p>
        <span className="pathway-link">Start here</span>
      </button>
    );
  }

  return (
    <a
      className="pathway-card"
      href={card.href}
      target={card.href.startsWith('http') ? '_blank' : undefined}
      rel={card.href.startsWith('http') ? 'noreferrer' : undefined}
    >
      <span className="pathway-eyebrow">{card.eyebrow}</span>
      <h3>{card.title}</h3>
      <p>{card.text}</p>
      <span className="pathway-link">{card.id === 'give' ? 'See ways to help' : 'Take action'}</span>
    </a>
  );
}

function IntakePanel({ onClose }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState({ audience: '', need: '' });

  const recommendation = useMemo(() => {
    const selectedNeed = answers.need || 'referral';
    return SUPPORT_LINKS[selectedNeed];
  }, [answers.need]);

  const isComplete = stepIndex >= INTAKE_STEPS.length;
  const currentStep = INTAKE_STEPS[Math.min(stepIndex, INTAKE_STEPS.length - 1)];

  const handleOptionSelect = (value) => {
    const nextAnswers = {
      ...answers,
      [currentStep.id]: value,
    };

    setAnswers(nextAnswers);
    setStepIndex((current) => current + 1);
  };

  const handleBack = () => {
    if (isComplete) {
      setStepIndex(INTAKE_STEPS.length - 1);
      return;
    }

    if (stepIndex === 0) {
      onClose();
      return;
    }

    setStepIndex((current) => current - 1);
  };

  return (
    <aside className="intake-panel" aria-live="polite">
      <div className="intake-topline">
        <span>Fast guide</span>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>

      {!isComplete ? (
        <>
          <div className="intake-progress">
            <div
              className="intake-progress-bar"
              style={{ width: `${((stepIndex + 1) / INTAKE_STEPS.length) * 100}%` }}
            />
          </div>
          <p className="intake-step-label">
            Step {stepIndex + 1} of {INTAKE_STEPS.length}
          </p>
          <h3>{currentStep.question}</h3>
          <div className="intake-options">
            {currentStep.options.map((option) => (
              <button key={option.value} type="button" onClick={() => handleOptionSelect(option.value)}>
                {option.label}
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="intake-result">
          <p className="intake-step-label">Recommended next step</p>
          <h3>{recommendation.title}</h3>
          <p>{recommendation.text}</p>
          <a className="button button-solid" href={recommendation.href}>
            {recommendation.action}
          </a>
          <button className="button button-ghost button-dark-outline" type="button" onClick={() => setStepIndex(0)}>
            Start over
          </button>
        </div>
      )}

      <button className="intake-back" type="button" onClick={handleBack}>
        {stepIndex === 0 && !isComplete ? 'Back to homepage' : 'Back'}
      </button>
    </aside>
  );
}

function App() {
  const [showHelpPanel, setShowHelpPanel] = useState(false);

  return (
    <div className="page-shell">
      <div className="notice-bar">
        Summer meals are available now. Families can find a nearby site with no registration required.
      </div>

      <header className="site-header">
        <a className="brand" href="https://www.hungertaskforce.org/" target="_blank" rel="noreferrer">
          <img
            src="https://www.hungertaskforce.org/wp-content/uploads/2022/01/htf_logo_2022.png"
            alt="Hunger Task Force"
          />
          <span>Milwaukee&apos;s Free and Local food bank</span>
        </a>

        <nav className="site-nav" aria-label="Primary">
          <a href="https://www.hungertaskforce.org/get-help/" target="_blank" rel="noreferrer">
            Get help
          </a>
          <a href="https://www.hungertaskforce.org/what-we-do/" target="_blank" rel="noreferrer">
            What we do
          </a>
          <a href="https://www.hungertaskforce.org/volunteer/" target="_blank" rel="noreferrer">
            Volunteer
          </a>
          <a href="#monthly-giving" className="button button-solid">
            Donate
          </a>
        </nav>
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">Hunger Task Force</p>
            <h1>Everyone deserves a dignified path to good food.</h1>
            <p className="hero-text">
              This homepage concept is built around one fast question: how can we help today? Food
              support, giving, and advocacy each get a direct path from the first screen.
            </p>
            <div className="hero-actions">
              <button className="button button-solid" type="button" onClick={() => setShowHelpPanel(true)}>
                Find food help
              </button>
              <a
                className="button button-ghost"
                href="https://www.hungertaskforce.org/volunteer/"
                target="_blank"
                rel="noreferrer"
              >
                Volunteer
              </a>
            </div>
            <div className="hero-proof">
              <span>Free and local.</span>
              <span>Trusted food access pathways.</span>
              <span>Built to move people faster.</span>
            </div>
          </div>

          <div className="hero-visual">
            <div className="hero-image-wrap">
              <img
                className="hero-image"
                src="https://www.hungertaskforce.org/wp-content/uploads/2026/03/2026.03-silver-spring-neighborhood-center-food-pantry-5-1080x675.jpg"
                alt="Community members accessing food support through Hunger Task Force."
              />
              <div className="hero-badge">
                <strong>Built for action</strong>
                <span>Help seekers, donors, and advocates all have a clear first move.</span>
              </div>
            </div>

            {showHelpPanel ? (
              <IntakePanel onClose={() => setShowHelpPanel(false)} />
            ) : (
              <div className="hero-panel-placeholder">
                <p className="eyebrow">Quick path</p>
                <h3>Need food support?</h3>
                <p>
                  Start the short guide to find pantries, FoodShare help, senior support, or family
                  resources in under a minute.
                </p>
                <button className="button button-solid" type="button" onClick={() => setShowHelpPanel(true)}>
                  Open guide
                </button>
              </div>
            )}
          </div>
        </section>

        <section className="pathways" aria-label="Homepage pathways">
          {PATHWAYS.map((card) => (
            <PathwayCard key={card.id} card={card} onOpenHelp={() => setShowHelpPanel(true)} />
          ))}
        </section>

        <section className="stats-section">
          <p className="eyebrow eyebrow-dark">Proof in motion</p>
          <div className="stats-grid">
            {IMPACT_STATS.map((stat) => (
              <article key={stat.label} className="stat-card">
                <strong>{stat.value}</strong>
                <span>{stat.label}</span>
              </article>
            ))}
          </div>
        </section>

        <section className="story-section">
          <div className="story-copy">
            <p className="eyebrow eyebrow-dark">What this concept prioritizes</p>
            <h2>Access first. Story second. Trust throughout.</h2>
            <p>
              The concept keeps the first screen focused on immediate next steps, then broadens into
              proof of impact, program depth, and a clear recurring donor ask. That keeps the
              experience useful for people in need while still serving supporters and partners.
            </p>
            <ul className="story-points">
              <li>Direct access to emergency food, FoodShare, senior support, and family help</li>
              <li>Program storytelling centered on real community work, not generic nonprofit chrome</li>
              <li>A recurring donor call to action tied to local impact</li>
            </ul>
          </div>

          <div className="story-photo">
            <img
              src="https://www.hungertaskforce.org/wp-content/uploads/2026/04/Cecelia-Gore-Friend-of-Free-Local-9x6-1-1080x675.jpg"
              alt="Community partner portrait featured by Hunger Task Force."
            />
          </div>
        </section>

        <section className="program-section">
          <div className="section-heading">
            <p className="eyebrow eyebrow-dark">Programs worth surfacing</p>
            <h2>Three ways the homepage can show depth without slowing people down.</h2>
          </div>

          <div className="program-grid">
            {PROGRAMS.map((program) => (
              <a
                key={program.title}
                className="program-card"
                href={program.href}
                target="_blank"
                rel="noreferrer"
                style={{ '--program-image': `url(${program.image})` }}
              >
                <div className="program-card-copy">
                  <p>{program.title}</p>
                  <span>{program.text}</span>
                </div>
              </a>
            ))}
          </div>
        </section>

        <section className="support-section">
          <div className="section-heading">
            <p className="eyebrow eyebrow-dark">Support routes</p>
            <h2>Each audience gets a concrete next step, not just a broad category page.</h2>
          </div>

          <div className="support-grid">
            {Object.values(SUPPORT_LINKS).map((link) => (
              <a key={link.title} className="support-link" href={link.href}>
                <strong>{link.title}</strong>
                <p>{link.text}</p>
                <span>{link.action}</span>
              </a>
            ))}
          </div>
        </section>

        <section className="donation-section" id="monthly-giving">
          <div className="donation-copy">
            <p className="eyebrow">Recurring giving</p>
            <h2>Become a monthly donor and keep every dollar working close to home.</h2>
            <p>
              A steady gift helps Hunger Task Force respond quickly, support trusted neighborhood
              partners, and keep fresh food moving through Milwaukee year-round.
            </p>
          </div>

          <div className="donation-actions">
            {['10', '25', '50', '100'].map((amount) => (
              <a
                key={amount}
                className="donation-chip"
                href="https://www.hungertaskforce.org/donate/"
                target="_blank"
                rel="noreferrer"
              >
                ${amount}/mo
              </a>
            ))}
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div>
          <h3>Hunger Task Force</h3>
          <p>5000 W. Electric Avenue, West Milwaukee, WI 53219</p>
          <p>(414) 777-0483</p>
        </div>
        <div>
          <h4>Get help</h4>
          <a href="https://www.hungertaskforce.org/get-help/emergency-food/">Emergency food</a>
          <a href="https://www.hungertaskforce.org/get-help/foodshare-resources/">FoodShare</a>
          <a href="https://www.hungertaskforce.org/get-help/help-for-seniors/">Seniors</a>
        </div>
        <div>
          <h4>Get involved</h4>
          <a href="https://www.hungertaskforce.org/donate/">Donate</a>
          <a href="https://www.hungertaskforce.org/volunteer/">Volunteer</a>
          <a href="https://www.hungertaskforce.org/what-we-do/advocacy/">Advocacy</a>
        </div>
      </footer>
    </div>
  );
}

export default App;

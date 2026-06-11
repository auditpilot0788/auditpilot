/**
 * AuditPilot — Report Generator v1.1
 * Builds a styled HTML template from scan results and exports to PDF via Playwright.
 *
 * Features: EAA readiness score, compliance dashboard, AI-ready issue explanations,
 * element screenshots, remediation effort rating, priority fixes, and agency config.
 */

const { chromium } = require('playwright-core');
const fs   = require('fs');
const path = require('path');
const config = require('./config');

// ── Helpers ────────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;');
}

function toDataUri(filePath) {
  try {
    if (filePath && fs.existsSync(filePath))
      return `data:image/png;base64,${fs.readFileSync(filePath).toString('base64')}`;
  } catch {}
  return null;
}

// ── Impact colours ─────────────────────────────────────────────────────────────

const IMPACT_COLORS = {
  critical: '#dc2626', serious: '#ea580c', moderate: '#d97706', minor: '#2563eb'
};
const impactColor = (impact) => IMPACT_COLORS[impact] || '#6b7280';

// ── Issue Explanations ─────────────────────────────────────────────────────────
// Covers the 20 most common axe-core rule IDs. Unknown rules fall back to a
// generic explanation derived from the violation's own metadata.

const EXPLANATIONS = {
  'color-contrast': {
    summary: 'Text colour does not have sufficient contrast against its background.',
    whyItMatters: 'Users with low vision, colour blindness, or in bright environments cannot read text that lacks adequate contrast — making content invisible to a significant portion of users.',
    businessImpact: 'Colour contrast failures appear in the majority of accessibility legal complaints. They affect an estimated 300 million people with colour blindness alone.',
    fix: 'Ensure normal text meets 4.5:1 contrast and large text (18pt+, or 14pt+ bold) meets 3:1. Verify all colours using the WebAIM Contrast Checker.',
    example: '/* Failing: ~2.3:1 */\ncolor: #aaaaaa; background: #ffffff;\n\n/* WCAG AA pass: 7:1 */\ncolor: #595959; background: #ffffff;'
  },
  'image-alt': {
    summary: 'One or more images are missing descriptive alternative text.',
    whyItMatters: 'Screen readers read alt text aloud in place of images. Without it, blind and low-vision users receive no information from visual content.',
    businessImpact: 'Missing alt text excludes visually impaired users, reduces SEO performance, and is among the top reasons cited in accessibility lawsuits.',
    fix: 'Add a descriptive alt attribute to every meaningful image. Use alt="" for purely decorative images so screen readers skip them.',
    example: '<!-- Missing -->\n<img src="hero.jpg">\n\n<!-- Descriptive -->\n<img src="hero.jpg" alt="Support team at our London office">\n\n<!-- Decorative -->\n<img src="divider.png" alt="">'
  },
  'label': {
    summary: 'Form inputs do not have programmatically associated labels.',
    whyItMatters: 'Screen readers announce the label when a user focuses an input. Without one, users cannot know what information is expected — placeholder text disappears on typing.',
    businessImpact: 'Unlabelled forms prevent assistive technology users from completing purchases, registrations, and enquiries, directly reducing conversions.',
    fix: 'Use a label element linked via matching for/id attributes, or wrap the input inside its label element.',
    example: '<!-- No label -->\n<input type="email" placeholder="Email">\n\n<!-- Fixed -->\n<label for="email">Email address</label>\n<input type="email" id="email">'
  },
  'heading-order': {
    summary: 'Heading levels are skipped or used out of logical sequence.',
    whyItMatters: 'Screen reader users navigate pages by jumping between headings. Skipping levels (e.g. H1 → H3) creates a confusing structure that is hard to scan.',
    businessImpact: 'Broken heading order prevents efficient page navigation, increasing task time and abandonment rates.',
    fix: 'Use headings in strict nested hierarchy: H1 → H2 → H3. Apply CSS for visual sizing rather than choosing heading level for appearance.',
    example: '<!-- Skipped heading -->\n<h1>Company</h1>\n<h3>Services</h3>\n\n<!-- Fixed -->\n<h1>Company</h1>\n<h2>Services</h2>\n<h3>Web Design</h3>'
  },
  'link-name': {
    summary: 'Links do not have descriptive, accessible names.',
    whyItMatters: 'Screen readers list all links on a page. Generic text like "click here" is meaningless out of context, making navigation impossible for many users.',
    businessImpact: 'Ambiguous link text prevents effective navigation for screen reader users and reduces SEO value.',
    fix: 'Write link text that describes the destination. Supplement with aria-label if visible text must remain short.',
    example: '<!-- Ambiguous -->\n<a href="/report.pdf">Click here</a>\n\n<!-- Descriptive -->\n<a href="/report.pdf">Download 2024 Accessibility Report (PDF)</a>'
  },
  'button-name': {
    summary: 'Buttons are missing accessible names.',
    whyItMatters: 'Screen readers announce button names on focus. An icon-only button without a label is completely opaque to blind users — they cannot know what it does.',
    businessImpact: 'Unlabelled buttons block screen reader users from performing key actions, often preventing entire workflows.',
    fix: 'Add visible text, aria-label, or aria-labelledby to every button. Mark decorative icons with aria-hidden="true".',
    example: '<!-- No name -->\n<button><svg>...</svg></button>\n\n<!-- Fixed -->\n<button aria-label="Close navigation menu">\n  <svg aria-hidden="true">...</svg>\n</button>'
  },
  'html-has-lang': {
    summary: 'The HTML element is missing a lang attribute.',
    whyItMatters: 'Screen readers use lang to select the correct pronunciation voice. Without it, content may be read in the wrong language — rendering it unintelligible.',
    businessImpact: 'A missing lang attribute degrades the experience for every screen reader user on the site. It is one of the simplest WCAG failures to fix.',
    fix: 'Add a valid BCP 47 language code as the lang attribute on the opening HTML tag.',
    example: '<!-- Missing -->\n<html>\n\n<!-- Fixed -->\n<html lang="en">'
  },
  'document-title': {
    summary: 'The page is missing a descriptive title element.',
    whyItMatters: 'Screen readers announce the page title on load. Without it, users cannot tell which page they are on — critical when managing multiple browser tabs.',
    businessImpact: 'Missing titles disorient screen reader users and harm SEO rankings and social sharing previews.',
    fix: 'Add a unique, descriptive title to every page that names both the content and the website.',
    example: '<!-- Generic -->\n<title>Home</title>\n\n<!-- Descriptive -->\n<title>Dashboard — AuditPilot Accessibility Reports</title>'
  },
  'duplicate-id-active': {
    summary: 'Multiple interactive elements share the same id attribute.',
    whyItMatters: 'Assistive technologies use id to match labels with controls. Duplicate IDs break form labelling and ARIA relationships silently.',
    businessImpact: 'Duplicate IDs cause hard-to-detect breakage that renders interactive features unusable for assistive technology users.',
    fix: 'Ensure every id attribute value is unique within the page.',
    example: '<!-- Duplicate -->\n<input id="name"> ...\n<input id="name">\n\n<!-- Fixed -->\n<input id="first-name">\n<input id="last-name">'
  },
  'aria-required-attr': {
    summary: 'ARIA roles are missing their required attributes.',
    whyItMatters: 'ARIA roles communicate widget behaviour to assistive technologies. Missing required attributes leave widgets in an undefined state — broken ARIA is often worse than no ARIA.',
    businessImpact: 'Incomplete ARIA confuses screen reader users and may render interactive components entirely inaccessible.',
    fix: 'Check the WAI-ARIA spec for required attributes per role. For example, role="checkbox" requires aria-checked.',
    example: '<!-- Missing required attr -->\n<div role="checkbox">Subscribe</div>\n\n<!-- Fixed -->\n<div role="checkbox" aria-checked="false" tabindex="0">Subscribe</div>'
  },
  'bypass': {
    summary: 'No skip navigation link or landmark regions are present.',
    whyItMatters: 'Without skip links, keyboard users must tab through every navigation item on every page before reaching main content.',
    businessImpact: 'Missing skip links significantly increase navigation time and cause fatigue for keyboard-only users.',
    fix: 'Add a "Skip to main content" link as the first focusable element, or structure the page with ARIA landmark roles.',
    example: '<a href="#main" class="skip-link">Skip to main content</a>\n\n<main id="main">...</main>'
  },
  'meta-viewport': {
    summary: 'The viewport meta tag disables user zoom/scaling.',
    whyItMatters: 'Low-vision users rely on pinch-zoom to enlarge content. user-scalable=no removes this critical ability.',
    businessImpact: 'Blocking zoom forces low-vision users to use separate tools and constitutes a WCAG 1.4.4 failure.',
    fix: 'Remove user-scalable=no and maximum-scale constraints entirely.',
    example: '<!-- Blocks zoom -->\n<meta name="viewport" content="width=device-width, user-scalable=no">\n\n<!-- Fixed -->\n<meta name="viewport" content="width=device-width, initial-scale=1">'
  },
  'tabindex': {
    summary: 'Positive tabindex values are disrupting natural keyboard focus order.',
    whyItMatters: 'Positive tabindex overrides the natural tab sequence, creating unpredictable navigation that does not match the visual layout.',
    businessImpact: 'Disrupted focus order is particularly harmful for motor-impaired users who rely on sequential, predictable navigation.',
    fix: 'Use only tabindex="0" or tabindex="-1". Avoid all positive tabindex values — manage focus order through DOM order instead.',
    example: '<!-- Disrupts order -->\n<button tabindex="3">Submit</button>\n\n<!-- Fixed - rely on DOM order -->\n<button>Submit</button>'
  },
  'autocomplete-valid': {
    summary: 'Form fields have invalid or missing autocomplete attributes.',
    whyItMatters: 'Browser autofill assists users with cognitive disabilities and motor impairments in completing forms accurately.',
    businessImpact: 'Proper autocomplete reduces form errors and abandonment for all users, especially those using voice input or switch controls.',
    fix: 'Add standard autocomplete tokens (name, email, tel, street-address, postal-code) to relevant fields.',
    example: '<!-- Missing -->\n<input type="text" name="email">\n\n<!-- Fixed -->\n<input type="email" name="email" autocomplete="email">'
  },
  'select-name': {
    summary: 'Select (dropdown) elements are missing accessible names.',
    whyItMatters: 'Screen readers announce what a dropdown is for when the user focuses it. Without a label, the user cannot know what selection they are making.',
    businessImpact: 'Unlabelled dropdowns block tasks like selecting country, date, or product variant for screen reader users.',
    fix: 'Associate a label element with every select using for/id, or add aria-label.',
    example: '<!-- No label -->\n<select name="country">...</select>\n\n<!-- Fixed -->\n<label for="country">Country</label>\n<select id="country" name="country">...</select>'
  },
  'video-caption': {
    summary: 'Video content does not provide captions for spoken audio.',
    whyItMatters: 'Deaf and hard-of-hearing users cannot access spoken content in videos without captions.',
    businessImpact: 'Uncaptioned video excludes deaf users and may breach EAA media content requirements.',
    fix: 'Add a track element with a .vtt caption file to all video elements.',
    example: '<video controls>\n  <source src="intro.mp4" type="video/mp4">\n  <track kind="captions" src="captions.vtt"\n         srclang="en" label="English">\n</video>'
  },
  'landmark-one-main': {
    summary: 'The page does not contain a main landmark region.',
    whyItMatters: 'Screen reader users jump to landmark regions to navigate quickly. Without a main landmark, they cannot skip to primary content.',
    businessImpact: 'Missing landmarks significantly increase navigation time for screen reader users.',
    fix: 'Wrap primary page content in a single main element.',
    example: '<!-- No landmark -->\n<div id="content">...</div>\n\n<!-- Fixed -->\n<main id="content">...</main>'
  },
  'frame-title': {
    summary: 'Iframes are missing descriptive title attributes.',
    whyItMatters: 'Screen readers announce iframe titles before users navigate into them. Without a title, users cannot know what an iframe contains.',
    businessImpact: 'Untitled iframes disorient screen reader users and may block access to embedded maps, videos, or widgets.',
    fix: 'Add a descriptive title attribute to every iframe.',
    example: '<!-- No title -->\n<iframe src="map.html"></iframe>\n\n<!-- Fixed -->\n<iframe src="map.html" title="Interactive office location map"></iframe>'
  },
  'scrollable-region-focusable': {
    summary: 'Scrollable elements cannot receive keyboard focus.',
    whyItMatters: 'Keyboard users must be able to scroll all scrollable regions with arrow keys. If a container is not focusable, its content may be completely inaccessible.',
    businessImpact: 'Inaccessible scrollable regions lock keyboard users out of data tables, code blocks, and chat interfaces.',
    fix: 'Add tabindex="0" to scrollable container elements that are not natively focusable.',
    example: '<!-- Not keyboard accessible -->\n<div style="overflow:auto">...</div>\n\n<!-- Fixed -->\n<div style="overflow:auto" tabindex="0">...</div>'
  },
  'input-image-alt': {
    summary: 'Image inputs (used as buttons) are missing accessible names.',
    whyItMatters: 'An <input type="image"> acts as a submit button. Without alt text, screen reader users cannot identify the button\'s purpose.',
    businessImpact: 'Inaccessible image inputs can block form submission for screen reader users, preventing purchase completion.',
    fix: 'Add a descriptive alt attribute to every input[type="image"].',
    example: '<!-- Missing alt -->\n<input type="image" src="submit.png">\n\n<!-- Fixed -->\n<input type="image" src="submit.png" alt="Submit order">'
  },
  'input-button-name': {
    summary: 'Input buttons (submit, reset, button type) do not have accessible names.',
    whyItMatters: 'Screen readers announce button labels when users focus on them. A button with no value or label is read as simply "button" — the user cannot know what it does.',
    businessImpact: 'Unlabelled submit buttons block screen reader users from completing forms, directly preventing conversions.',
    fix: 'Add a value attribute to input[type="submit"] and input[type="reset"]. For input[type="button"], use value or aria-label.',
    example: '<!-- No name -->\n<input type="submit">\n\n<!-- Fixed -->\n<input type="submit" value="Send enquiry">'
  },
  'aria-allowed-attr': {
    summary: 'ARIA attributes are being used on elements where they are not permitted.',
    whyItMatters: 'Invalid ARIA attributes are silently ignored by browsers, stripping the intended enhancement and leaving the element in an unintended accessible state.',
    businessImpact: 'Broken ARIA implementations degrade screen reader users\' experience and signal poor code quality to accessibility auditors.',
    fix: 'Consult the WAI-ARIA spec for permitted attributes per element role, and remove any attributes that are not allowed.',
    example: '<!-- Invalid: aria-checked on a plain div -->\n<div aria-checked="true">Item</div>\n\n<!-- Fixed -->\n<div role="checkbox" aria-checked="true" tabindex="0">Item</div>'
  },
  'aria-hidden-focus': {
    summary: 'Focusable elements are nested inside elements marked aria-hidden="true".',
    whyItMatters: 'Elements inside aria-hidden are invisible to screen readers, yet keyboard users can still tab into them — creating a hidden focus trap with no accessible context.',
    businessImpact: 'Users can become trapped on elements that screen readers cannot perceive, causing severe navigational confusion and keyboard accessibility failure.',
    fix: 'Either remove aria-hidden from the ancestor, or add tabindex="-1" to all focusable descendants to prevent keyboard focus.',
    example: '<!-- Focus trap -->\n<div aria-hidden="true">\n  <button>Hidden but focusable</button>\n</div>\n\n<!-- Fixed -->\n<div aria-hidden="true">\n  <button tabindex="-1">No longer reachable</button>\n</div>'
  },
  'aria-input-field-name': {
    summary: 'Custom ARIA input fields do not have accessible names.',
    whyItMatters: 'Custom input widgets using ARIA roles need labels just like native inputs. Without them, screen reader users cannot determine what a field expects.',
    businessImpact: 'Unnamed custom inputs block assistive technology users from completing search, checkout, and data entry tasks.',
    fix: 'Add aria-label or aria-labelledby to every element with an ARIA input role (textbox, searchbox, spinbutton, combobox).',
    example: '<!-- No label -->\n<div role="textbox" contenteditable></div>\n\n<!-- Fixed -->\n<label id="search-lbl">Search</label>\n<div role="searchbox" aria-labelledby="search-lbl" contenteditable></div>'
  },
  'aria-toggle-field-name': {
    summary: 'ARIA toggle controls (checkboxes, radios, switches) do not have accessible names.',
    whyItMatters: 'Toggle controls without names are announced as just "checkbox" or "switch" — users hear no indication of what they are toggling.',
    businessImpact: 'Unnamed toggles are especially harmful in consent, settings, and preference UIs where user choice is business-critical.',
    fix: 'Add aria-label or a visible label linked via aria-labelledby to every ARIA toggle control.',
    example: '<!-- No name -->\n<div role="switch" aria-checked="false"></div>\n\n<!-- Fixed -->\n<span id="notif-lbl">Email notifications</span>\n<div role="switch" aria-checked="false" aria-labelledby="notif-lbl"></div>'
  },
  'aria-valid-attr': {
    summary: 'Unknown or misspelled ARIA attributes are present.',
    whyItMatters: 'Unrecognised ARIA attributes are silently ignored — the intended enhancement is completely lost, while the invalid markup remains in the source.',
    businessImpact: 'Misspelled ARIA is wasted effort and a red flag in accessibility audits. It indicates ARIA is being written without validation.',
    fix: 'Use only ARIA attribute names exactly as defined in the WAI-ARIA spec. Add an accessibility linter to catch typos in CI.',
    example: '<!-- Typo -->\n<button aria-labl="Close">X</button>\n\n<!-- Fixed -->\n<button aria-label="Close">X</button>'
  },
  'aria-required-children': {
    summary: 'ARIA composite roles are missing required child roles.',
    whyItMatters: 'Composite ARIA widgets (listbox, tree, grid, tablist) require specific child roles to be valid. Missing children leave the widget in an undefined, unpredictable state.',
    businessImpact: 'Broken composite widgets are among the most common causes of screen reader confusion in custom UI components.',
    fix: 'Check the WAI-ARIA spec for required owned elements per role, and ensure all required children are present with correct roles.',
    example: '<!-- Missing role="option" on children -->\n<ul role="listbox">\n  <li>Option 1</li>\n</ul>\n\n<!-- Fixed -->\n<ul role="listbox">\n  <li role="option">Option 1</li>\n</ul>'
  },
  'duplicate-id': {
    summary: 'Multiple elements share the same id attribute value.',
    whyItMatters: 'Duplicate IDs break ARIA relationships (aria-labelledby, aria-describedby) and cause browsers to resolve id references unpredictably.',
    businessImpact: 'Duplicate IDs cause silent ARIA failures and inconsistent screen reader behaviour across browsers.',
    fix: 'Ensure every id is unique within the document. Treat IDs as primary keys — one per element per page.',
    example: '<!-- Duplicate -->\n<p id="desc">Info 1</p>\n<p id="desc">Info 2</p>\n\n<!-- Fixed -->\n<p id="desc-1">Info 1</p>\n<p id="desc-2">Info 2</p>'
  },
  'duplicate-id-aria': {
    summary: 'IDs referenced by ARIA attributes (aria-labelledby, aria-describedby) are not unique.',
    whyItMatters: 'ARIA attributes rely on unique IDs to create programmatic associations. Duplicates mean the wrong element — or nothing — gets announced by screen readers.',
    businessImpact: 'Broken ARIA associations cause form controls, dialogs, and widgets to be mis-labelled or silently unlabelled for screen reader users.',
    fix: 'Ensure any ID referenced in an ARIA attribute is unique in the document, especially in dynamically rendered components.',
    example: '<!-- Duplicate ARIA reference -->\n<span id="lbl">Name</span>\n<input aria-labelledby="lbl">\n<span id="lbl">Email</span>  ← duplicate!\n\n<!-- Fixed -->\n<span id="name-lbl">Name</span>\n<input aria-labelledby="name-lbl">'
  },
  'empty-heading': {
    summary: 'Heading elements (H1–H6) contain no visible text content.',
    whyItMatters: 'Empty headings appear as blank entries in screen reader navigation lists, disorienting users who rely on headings to understand and jump to page sections.',
    businessImpact: 'Empty headings reveal that heading elements are being used for visual styling rather than semantic structure — a systemic pattern of accessibility debt.',
    fix: 'Add descriptive text to every heading element. If a heading exists only for visual spacing, replace it with a div and apply styles via CSS.',
    example: '<!-- Empty heading -->\n<h2></h2>\n\n<!-- Fixed -->\n<h2>Our Services</h2>'
  },
  'form-field-multiple-labels': {
    summary: 'A form field is associated with more than one label element.',
    whyItMatters: 'Multiple labels cause screen readers to announce them in unexpected combinations — users may hear duplicate or partially announced label text.',
    businessImpact: 'Multiple labels often result from duplicated or auto-generated form markup, indicating structural issues that affect form reliability and screen reader behaviour.',
    fix: 'Ensure each form field is linked to exactly one label. If multiple descriptions are needed, consolidate them into a single label or use aria-describedby for the secondary text.',
    example: '<!-- Two labels on one input -->\n<label for="email">Email</label>\n<label for="email">Your address</label>\n<input id="email" type="email">\n\n<!-- Fixed -->\n<label for="email">Email address</label>\n<input id="email" type="email">'
  },
  'image-redundant-alt': {
    summary: 'An image\'s alt text duplicates adjacent visible text.',
    whyItMatters: 'Screen readers announce both the adjacent text and the alt attribute, causing the same information to be read twice — disorienting and time-consuming for users.',
    businessImpact: 'Redundant alt text creates a poor screen reader experience and indicates that the purpose of alt text is misunderstood in the codebase.',
    fix: 'When an image is already described by adjacent visible text, set alt="" to mark it as decorative so screen readers skip it.',
    example: '<!-- Redundant: said twice -->\n<img src="logo.png" alt="AuditPilot Logo">\n<p>AuditPilot Logo</p>\n\n<!-- Fixed -->\n<img src="logo.png" alt="">\n<p>AuditPilot Logo</p>'
  },
  'interactive-supports-focus': {
    summary: 'Interactive elements cannot receive keyboard focus.',
    whyItMatters: 'Every interactive element must be reachable by keyboard. Non-focusable interactive controls are completely inaccessible to keyboard-only users and most screen reader users.',
    businessImpact: 'Keyboard-inaccessible controls — especially custom buttons, dropdowns, and modals — block entire user flows for users who cannot use a mouse.',
    fix: 'Use native HTML interactive elements (button, a, input, select) wherever possible. For custom widgets, add tabindex="0" and implement keyboard event handlers.',
    example: '<!-- Not keyboard focusable -->\n<div onclick="submit()">Submit</div>\n\n<!-- Fixed -->\n<button onclick="submit()">Submit</button>'
  },
  'list': {
    summary: 'List elements (ul, ol, dl) contain invalid direct child elements.',
    whyItMatters: 'Screen readers announce list type and item count using semantic list structure. Invalid children break this metadata, confusing users navigating by list.',
    businessImpact: 'Invalid list markup frequently appears in navigation and menu components, affecting how entire navigation structures are perceived by screen reader users.',
    fix: 'Ensure ul and ol elements contain only li elements as direct children. Use li for every list item.',
    example: '<!-- Invalid children -->\n<ul>\n  <div>Item 1</div>\n  <div>Item 2</div>\n</ul>\n\n<!-- Fixed -->\n<ul>\n  <li>Item 1</li>\n  <li>Item 2</li>\n</ul>'
  },
  'listitem': {
    summary: 'List item elements (li, dt, dd) are not inside their required parent list element.',
    whyItMatters: 'Orphaned list items have no semantic meaning. Screen readers may announce them incorrectly or treat them as plain text with no list context.',
    businessImpact: 'Orphaned list items indicate HTML structure errors that degrade screen reader navigation of menus and content lists.',
    fix: 'Ensure all li elements are direct children of ul or ol. Wrap dt and dd elements inside a dl element.',
    example: '<!-- Orphaned -->\n<div>\n  <li>Item 1</li>\n</div>\n\n<!-- Fixed -->\n<ul>\n  <li>Item 1</li>\n</ul>'
  },
  'nested-interactive': {
    summary: 'Interactive elements are nested inside other interactive elements.',
    whyItMatters: 'HTML does not allow interactive elements (buttons, links, inputs) to be nested inside each other. Browsers handle this inconsistently and screen readers may mis-report the structure.',
    businessImpact: 'Nested interactive elements cause unpredictable focus and activation behaviour — a common problem in card-based UIs where entire cards are made clickable.',
    fix: 'Restructure the HTML to avoid nesting interactive elements. Use a single outer focusable element and CSS pseudo-elements to extend the click area.',
    example: '<!-- Invalid nesting -->\n<a href="/product">\n  <button>Buy now</button>\n</a>\n\n<!-- Fixed -->\n<div class="card">\n  <a href="/product">View product</a>\n  <button>Buy now</button>\n</div>'
  },
  'no-autoplay-audio': {
    summary: 'Audio or video content starts playing automatically on page load.',
    whyItMatters: 'Autoplaying audio interferes with screen readers, which compete with simultaneous audio output. It also disorients users with cognitive disabilities or audio sensitivity.',
    businessImpact: 'Autoplaying media is one of the most complained-about accessibility issues and a direct violation of WCAG 1.4.2 (Audio Control).',
    fix: 'Remove autoplay from all audio and video elements. Let users initiate playback through visible, labelled controls.',
    example: '<!-- Autoplays on load -->\n<video autoplay src="intro.mp4"></video>\n\n<!-- Fixed -->\n<video controls src="intro.mp4">\n  <track kind="captions" src="captions.vtt">\n</video>'
  },
  'page-has-heading-one': {
    summary: 'The page does not contain an H1 heading.',
    whyItMatters: 'The H1 heading identifies the primary topic of a page. Screen reader users depend on it as the first navigation target to understand what the page is about before exploring further.',
    businessImpact: 'Missing H1 headings confuse screen reader users and significantly harm SEO — search engines use H1 as the primary content signal.',
    fix: 'Add a single, descriptive H1 heading near the top of each page that clearly describes its content.',
    example: '<!-- No H1 -->\n<h2>Services</h2>\n<h2>About Us</h2>\n\n<!-- Fixed -->\n<h1>Digital Agency Services</h1>\n<h2>Web Design</h2>'
  },
  'region': {
    summary: 'Visible page content is not contained within ARIA landmark regions.',
    whyItMatters: 'Landmark regions (header, nav, main, footer) let screen reader users jump to key page areas without navigating through all content. Content outside landmarks is harder to discover.',
    businessImpact: 'Pages without landmarks force screen reader users to navigate linearly through all content — significantly increasing time-on-task and abandonment rates.',
    fix: 'Wrap all visible page content in appropriate HTML5 landmark elements: header, nav, main, aside, and footer.',
    example: '<!-- No landmarks -->\n<div class="nav">...</div>\n<div class="content">...</div>\n\n<!-- Fixed -->\n<header>...</header>\n<nav aria-label="Main navigation">...</nav>\n<main>...</main>\n<footer>...</footer>'
  },
  'role-img-alt': {
    summary: 'Elements with role="img" do not have a text alternative.',
    whyItMatters: 'Custom image elements using role="img" need text alternatives just like native img elements. Without them, the visual information they convey is completely hidden from screen readers.',
    businessImpact: 'Icon fonts, CSS-generated images, and custom SVG components without labels exclude screen reader users from visual content.',
    fix: 'Add aria-label to any element with role="img", or reference a label element using aria-labelledby.',
    example: '<!-- No alternative -->\n<div role="img" class="hero-icon"></div>\n\n<!-- Fixed -->\n<div role="img" class="hero-icon" aria-label="Security shield icon"></div>'
  },
  'svg-img-alt': {
    summary: 'Inline SVG images used as meaningful content do not have accessible names.',
    whyItMatters: 'SVG elements used as images are invisible to screen readers without a text alternative — blind users cannot perceive the visual information they convey.',
    businessImpact: 'SVG icons and illustrations are pervasive in modern UIs. Without labels, they exclude screen reader users from iconographic meaning across the entire interface.',
    fix: 'Add a title element as the first child of the SVG, or use aria-label with role="img" on the SVG element.',
    example: '<!-- Not accessible -->\n<svg viewBox="0 0 24 24">...</svg>\n\n<!-- Fixed -->\n<svg viewBox="0 0 24 24" role="img" aria-label="Search">\n  <title>Search</title>\n  ...\n</svg>'
  },
  'td-headers-attr': {
    summary: 'Table data cells reference header IDs that do not exist or are not th elements.',
    whyItMatters: 'Screen readers use header associations to announce which column and row a cell belongs to. Broken references make table data impossible to understand in context.',
    businessImpact: 'Data tables with broken header associations are incomprehensible to screen reader users — structured data becomes a meaningless list of values.',
    fix: 'Ensure headers attributes reference valid th element IDs. For simple tables, use scope="col" or scope="row" on th elements instead.',
    example: '<!-- Typo in headers ref -->\n<th id="name">Name</th>\n<td headers="nmae">Alice</td>\n\n<!-- Fixed -->\n<th id="name" scope="col">Name</th>\n<td headers="name">Alice</td>'
  },
  'th-has-data-cells': {
    summary: 'Table header cells do not have associated data cells.',
    whyItMatters: 'Headers without data cells suggest incorrect table structure — often caused by using th elements for visual styling rather than semantic meaning.',
    businessImpact: 'Incorrectly structured tables cause screen readers to announce false column/row relationships, making tabular data misleading.',
    fix: 'Ensure every th element logically heads at least one td cell. Use thead and tbody to separate header and data rows.',
    example: '<!-- Orphaned header -->\n<tr><th>Name</th><th>Score</th></tr>\n<tr><th>Totals</th><td>42</td></tr>\n\n<!-- Fixed -->\n<thead><tr><th scope="col">Name</th><th scope="col">Score</th></tr></thead>\n<tbody><tr><td>Alice</td><td>42</td></tr></tbody>'
  },
  'valid-lang': {
    summary: 'A lang attribute contains an invalid or unrecognised language code.',
    whyItMatters: 'Screen readers use lang to select the correct pronunciation voice. An invalid code may cause content to be mispronounced or read in the wrong language — rendering it unintelligible.',
    businessImpact: 'Invalid language codes cause audibly incorrect pronunciation for screen reader users, especially damaging on multilingual sites.',
    fix: 'Use only valid BCP 47 language codes: e.g. "en", "en-GB", "fr", "de", "zh-Hant".',
    example: '<!-- Invalid -->\n<p lang="english">Hello</p>\n\n<!-- Fixed -->\n<p lang="en">Hello</p>\n<p lang="en-GB">British English content</p>'
  },
  'html-lang-valid': {
    summary: 'The HTML lang attribute contains an invalid language code.',
    whyItMatters: 'An invalid language code on the root HTML element means screen readers cannot select the correct voice for the entire page — affecting every single user.',
    businessImpact: 'Invalid page-level language is a one-line fix with broad impact, affecting all screen reader users on every visit.',
    fix: 'Replace the invalid code with a valid BCP 47 language tag.',
    example: '<!-- Invalid -->\n<html lang="english">\n\n<!-- Fixed -->\n<html lang="en">'
  },
  'skip-link': {
    summary: 'A skip navigation link is present but does not work correctly.',
    whyItMatters: 'A broken skip link is worse than no skip link — keyboard users activate it expecting to jump past navigation, but instead remain where they are or focus on the wrong element.',
    businessImpact: 'Broken skip links create false confidence that keyboard accessibility is implemented while still failing users who depend on it.',
    fix: 'Verify the skip link href matches the id of the target element, and that the target has tabindex="-1" to receive programmatic focus.',
    example: '<!-- Target ID mismatch -->\n<a href="#main">Skip to content</a>\n<div id="content">...</div>\n\n<!-- Fixed -->\n<a href="#main">Skip to content</a>\n<main id="main" tabindex="-1">...</main>'
  },
  'object-alt': {
    summary: 'Object elements do not have accessible text alternatives.',
    whyItMatters: 'The object element embeds content (PDFs, legacy plugins, etc.). Without a fallback text alternative, users who cannot access the embedded content receive nothing.',
    businessImpact: 'Inaccessible object elements hide embedded content from screen reader users and users whose browsers do not support the embedded format.',
    fix: 'Place descriptive fallback content inside the object element, or add an aria-label attribute to describe it.',
    example: '<!-- No alternative -->\n<object data="doc.pdf" type="application/pdf"></object>\n\n<!-- Fixed -->\n<object data="doc.pdf" type="application/pdf"\n        aria-label="2024 Annual Report PDF">\n  <a href="doc.pdf">Download Annual Report (PDF)</a>\n</object>'
  }
};

function getIssueExplanation(violation) {
  const known = EXPLANATIONS[violation.id];
  if (known) return known;
  return {
    summary:        violation.help || violation.description,
    whyItMatters:   'This issue may prevent users relying on assistive technologies from accessing the affected content.',
    businessImpact: 'Unresolved accessibility violations create compliance risk and reduce usability for users with disabilities.',
    fix:            `Review the WCAG guidance at ${violation.helpUrl} for specific remediation steps.`,
    example:        null
  };
}

// ── Score & risk helpers ───────────────────────────────────────────────────────

function getScoreStatus(score) {
  if (score >= 90) return { label: 'Excellent',         color: '#16a34a' };
  if (score >= 70) return { label: 'Good',              color: '#2563eb' };
  if (score >= 50) return { label: 'Needs Improvement', color: '#d97706' };
  return              { label: 'High Risk',             color: '#dc2626' };
}

function getEaaStyle(eaaRisk) {
  const map = {
    'Low Risk':      { color: '#16a34a', bg: 'rgba(22,163,74,.12)'  },
    'Medium Risk':   { color: '#d97706', bg: 'rgba(217,119,6,.12)'  },
    'High Risk':     { color: '#ea580c', bg: 'rgba(234,88,12,.12)'  },
    'Critical Risk': { color: '#dc2626', bg: 'rgba(220,38,38,.12)'  }
  };
  return map[eaaRisk] || map['Medium Risk'];
}

// ── Remediation effort ─────────────────────────────────────────────────────────

function getRemediationEffort(totalIssues, counts) {
  if (totalIssues === 0)
    return { label: 'None',   color: '#16a34a', detail: 'No remediation required. Schedule a re-scan in 90 days to maintain compliance.' };
  if (counts.critical >= 3 || totalIssues >= 20)
    return { label: 'High',   color: '#dc2626', detail: 'Significant development effort required across multiple severity levels.' };
  if (counts.critical >= 1 || counts.serious >= 3 || totalIssues >= 8)
    return { label: 'Medium', color: '#d97706', detail: 'Moderate effort required. Prioritise critical and serious issues first.' };
  return   { label: 'Low',   color: '#16a34a', detail: 'Minimal effort required. Quick wins available through targeted, isolated fixes.' };
}

// ── Priority fixes ─────────────────────────────────────────────────────────────

function getPriorityFixes(groupedViolations) {
  const fixes = [];
  for (const severity of ['critical', 'serious', 'moderate', 'minor']) {
    for (const issue of (groupedViolations[severity] || [])) {
      if (fixes.length >= 3) return fixes;
      fixes.push({ severity, issue });
    }
  }
  return fixes;
}

// ── HTML sub-sections ──────────────────────────────────────────────────────────

function complianceDashboardHtml(score, eaaScore, eaaRisk) {
  const wcagLabel = score >= 90 ? 'Aligned'
                 : score >= 70 ? 'Partially Aligned'
                 : score >= 50 ? 'Needs Review'
                 :               'Non-Compliant';
  const wcagColor = score >= 90 ? '#16a34a'
                 : score >= 70 ? '#2563eb'
                 : score >= 50 ? '#d97706'
                 :               '#dc2626';
  const { color: eaaColor } = getEaaStyle(eaaRisk);

  return `
    <div class="comp-grid">
      <div class="comp-card">
        <div class="comp-icon">&#10003;</div>
        <div class="comp-title">WCAG 2.1 AA Alignment</div>
        <span class="comp-badge" style="background:${wcagColor}">${wcagLabel}</span>
        <p class="comp-detail">Score ${score}/100 against WCAG 2.1 Level AA criteria — the globally recognised standard for web accessibility.</p>
      </div>
      <div class="comp-card">
        <div class="comp-icon">&#9878;</div>
        <div class="comp-title">EAA Readiness</div>
        <span class="comp-badge" style="background:${eaaColor}">${eaaScore}/100</span>
        <p class="comp-detail">European Accessibility Act readiness score, weighted for legal barrier severity (critical violations penalised 1.5× more).</p>
      </div>
      <div class="comp-card">
        <div class="comp-icon">&#9888;</div>
        <div class="comp-title">Estimated Risk Level</div>
        <span class="comp-badge" style="background:${eaaColor}">${eaaRisk}</span>
        <p class="comp-detail">Overall compliance risk based on violation severity profile and EAA enforcement exposure.</p>
      </div>
    </div>`;
}

function findingsHtml(groupedViolations, elementScreenshots) {
  const ORDER = ['critical', 'serious', 'moderate', 'minor'];
  let html = '';

  for (const severity of ORDER) {
    const issues = groupedViolations[severity];
    if (!issues || issues.length === 0) continue;
    const color = impactColor(severity);

    html += `
      <div class="sev-section">
        <div class="sev-header" style="border-left:4px solid ${color}">
          <span class="sev-badge" style="background:${color}">${severity.toUpperCase()}</span>
          <span class="sev-count">${issues.length} issue${issues.length !== 1 ? 's' : ''}</span>
        </div>`;

    issues.forEach((issue, i) => {
      const expl   = getIssueExplanation(issue);
      const elemUri = elementScreenshots && elementScreenshots[issue.id]
        ? toDataUri(elementScreenshots[issue.id]) : null;

      html += `
        <div class="issue-card">
          <div class="issue-row">
            <span class="issue-num">#${i + 1}</span>
            <h3 class="issue-title">${escapeHtml(issue.help)}</h3>
            <span class="affected-badge">${issue.nodes.length} element${issue.nodes.length !== 1 ? 's' : ''}</span>
          </div>

          <div class="expl-wrap${elemUri ? ' has-shot' : ''}">
            <div class="expl-col">
              <div class="expl-block">
                <span class="expl-lbl">Issue Summary</span>
                <p class="expl-txt">${escapeHtml(expl.summary)}</p>
              </div>
              <div class="expl-block">
                <span class="expl-lbl">Why It Matters</span>
                <p class="expl-txt">${escapeHtml(expl.whyItMatters)}</p>
              </div>
              <div class="expl-block">
                <span class="expl-lbl">Business Impact</span>
                <p class="expl-txt">${escapeHtml(expl.businessImpact)}</p>
              </div>
              <div class="expl-block">
                <span class="expl-lbl">Recommended Fix</span>
                <p class="expl-txt">${escapeHtml(expl.fix)}</p>
              </div>
              ${expl.example ? `
              <div class="expl-block">
                <span class="expl-lbl">Developer Example</span>
                <pre class="expl-code">${escapeHtml(expl.example)}</pre>
              </div>` : ''}
              <div class="expl-block">
                <span class="expl-lbl">WCAG Reference</span>
                <p class="expl-txt" style="color:#2563eb;word-break:break-all">${escapeHtml(issue.helpUrl)}</p>
              </div>
            </div>
            ${elemUri ? `
            <div class="shot-col">
              <span class="expl-lbl">Affected Element</span>
              <img src="${elemUri}" alt="Screenshot of the affected element" class="elem-thumb">
            </div>` : ''}
          </div>
        </div>`;
    });

    html += `</div>`;
  }

  return html || '<p class="no-issues">No accessibility violations detected — great work!</p>';
}

// Generates one remediation step per unique violation found, ordered by severity.
// Steps are derived from the actual scan results — not a hardcoded generic list.
function nextStepsHtml(counts, totalIssues, groupedViolations) {
  if (totalIssues === 0) {
    return `
    <li class="step-item">
      <span class="step-num" style="background:#16a34a">1</span>
      <div>
        <strong>No critical issues found.</strong>
        <p class="step-detail">Schedule a re-scan in 90 days to maintain compliance.</p>
      </div>
    </li>`;
  }

  const steps = [];
  let n = 1;

  // One step per violation type, ordered critical → serious → moderate → minor
  for (const severity of ['critical', 'serious', 'moderate', 'minor']) {
    for (const violation of (groupedViolations[severity] || [])) {
      const expl  = getIssueExplanation(violation);
      const count = violation.nodes.length;
      steps.push({
        n:        n++,
        severity,
        heading:  `Fix ${count} "${escapeHtml(violation.help)}" violation${count !== 1 ? 's' : ''}`,
        detail:   escapeHtml(expl.fix)
      });
    }
  }

  // Always close with a re-scan step
  steps.push({
    n:        n,
    severity: null,
    heading:  'Re-scan after remediation to confirm improvements',
    detail:   'Run a fresh AuditPilot scan to verify the score has risen and the issue count has fallen before presenting to the client.'
  });

  return steps.map(s => `
    <li class="step-item">
      <span class="step-num" style="background:${s.severity ? impactColor(s.severity) : '#1a1a2e'}">${s.n}</span>
      <div>
        <strong>${s.heading}</strong>
        <p class="step-detail">${s.detail}</p>
      </div>
    </li>`).join('');
}

// ── Full HTML template ─────────────────────────────────────────────────────────

function buildReportHtml(url, scanResults) {
  const {
    score, counts, totalIssues, groupedViolations, screenshotPath,
    eaaScore, eaaRisk, elementScreenshots, duration, pagesScanned
  } = scanResults;

  const { label: statusLabel, color: statusColor } = getScoreStatus(score);
  const { color: eaaColor, bg: eaaBg }             = getEaaStyle(eaaRisk);
  const screenshotUri = toDataUri(screenshotPath);
  const scanDate = new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });

  const effort       = getRemediationEffort(totalIssues, counts);
  const priorityFixes = getPriorityFixes(groupedViolations);
  const agencyName   = config.agency.name;
  const version      = config.version;

  // Pre-build sections that contain complex logic
  const compSection    = complianceDashboardHtml(score, eaaScore, eaaRisk);
  const findSection    = findingsHtml(groupedViolations, elementScreenshots);
  const stepsSection   = nextStepsHtml(counts, totalIssues, groupedViolations);

  const prioritySection = priorityFixes.length === 0
    ? '<p style="font-size:12px;color:#6b7280;font-style:italic;padding:16px 0">No priority fixes required — the site passed all automated checks.</p>'
    : priorityFixes.map((f, i) => `
      <div class="pfix">
        <span class="pfix-num">${i + 1}</span>
        <div class="pfix-body">
          <div class="pfix-header">
            <span class="pfix-badge" style="background:${impactColor(f.severity)}">${f.severity.toUpperCase()}</span>
            <strong class="pfix-title">${escapeHtml(f.issue.help)}</strong>
          </div>
          <p class="pfix-detail">${f.issue.nodes.length} element${f.issue.nodes.length !== 1 ? 's' : ''} affected — ${escapeHtml(getIssueExplanation(f.issue).fix)}</p>
        </div>
      </div>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${agencyName} Accessibility Report</title>
<style>
/* ── Reset ── */
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',Arial,sans-serif;color:#1a1a2e;background:#fff;font-size:13px;line-height:1.6}

/* ── Page breaks ── */
.page{page-break-after:always}
@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}.page{page-break-after:always}}

/* ── Cover ── */
.cover{min-height:100vh;background:linear-gradient(150deg,#1a1a2e 0%,#16213e 55%,#0f3460 100%);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:50px 48px;text-align:center;color:#fff}
.cover-eyebrow{font-size:11px;font-weight:700;letter-spacing:4px;text-transform:uppercase;color:#e94560;margin-bottom:6px}
.cover-logo{font-size:48px;font-weight:900;color:#fff;letter-spacing:-2px;margin-bottom:4px}
.cover-logo span{color:#e94560}
.cover-tagline{font-size:11px;color:rgba(255,255,255,.4);letter-spacing:2.5px;text-transform:uppercase;margin-bottom:44px}
.cover-divider{width:48px;height:3px;background:#e94560;margin:0 auto 44px}
.cover-url{font-size:17px;color:rgba(255,255,255,.9);background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);padding:10px 22px;border-radius:8px;margin-bottom:8px;word-break:break-all}
.cover-date{font-size:11px;color:rgba(255,255,255,.4);margin-bottom:40px}

/* Scores row on cover */
.scores-row{display:flex;align-items:center;justify-content:center;gap:32px;margin-bottom:28px;flex-wrap:wrap}
.score-ring{width:130px;height:130px;border-radius:50%;border:5px solid #e94560;background:rgba(233,69,96,.08);display:flex;flex-direction:column;align-items:center;justify-content:center}
.score-num{font-size:50px;font-weight:900;color:#fff;line-height:1}
.score-denom{font-size:10px;color:rgba(255,255,255,.45);margin-top:2px}
.score-label{font-size:10px;color:rgba(255,255,255,.5);margin-top:6px;letter-spacing:1px;text-transform:uppercase}
.status-pill{display:inline-block;padding:6px 20px;border-radius:24px;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-top:8px}

.eaa-block{display:flex;flex-direction:column;align-items:center;gap:6px}
.eaa-ring{width:90px;height:90px;border-radius:50%;border:4px solid;display:flex;flex-direction:column;align-items:center;justify-content:center}
.eaa-num{font-size:32px;font-weight:900;color:#fff;line-height:1}
.eaa-denom{font-size:9px;color:rgba(255,255,255,.45);margin-top:1px}
.eaa-risk-pill{display:inline-block;padding:5px 16px;border-radius:20px;font-size:10px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:#fff}

.cover-screenshot{margin-top:28px;width:100%;max-width:520px;border-radius:10px;overflow:hidden;border:2px solid rgba(255,255,255,.15);box-shadow:0 20px 60px rgba(0,0,0,.5)}
.cover-screenshot img{width:100%;display:block;max-height:280px;object-fit:cover;object-position:top}
.cover-screenshot-lbl{font-size:10px;color:rgba(255,255,255,.3);margin-top:6px}

/* ── Shared content page ── */
.content{padding:44px 52px}
.page-hdr{display:flex;justify-content:space-between;align-items:center;padding-bottom:14px;border-bottom:2px solid #e94560;margin-bottom:32px}
.page-hdr-brand{font-size:11px;font-weight:700;letter-spacing:2px;color:#e94560}
.page-hdr-url{font-size:10px;color:#9ca3af;word-break:break-all;max-width:460px;text-align:right}
.sec-title{font-size:24px;font-weight:800;color:#1a1a2e;margin-bottom:5px}
.sec-sub{font-size:12px;color:#6b7280;margin-bottom:26px}

/* ── Executive Summary ── */
.summary-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:22px}
.s-card{border:1px solid #e5e7eb;border-radius:10px;padding:18px;text-align:center}
.s-card.dark{background:#1a1a2e;border-color:#1a1a2e}
.s-card .s-num{font-size:34px;font-weight:800;line-height:1;margin-bottom:4px}
.s-card .s-lbl{font-size:9px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:1px}
.s-card.dark .s-num,.s-card.dark .s-lbl{color:#fff}
.s-card.dark .s-lbl{color:rgba(255,255,255,.55)}
.s-card.critical .s-num{color:#dc2626}
.s-card.serious  .s-num{color:#ea580c}
.s-card.moderate .s-num{color:#d97706}
.s-card.minor    .s-num{color:#2563eb}
.score-bar-wrap{margin-top:14px}
.score-bar-label{display:flex;justify-content:space-between;font-size:10px;color:#374151;margin-bottom:5px}
.score-bar-track{background:#f3f4f6;border-radius:6px;height:9px;overflow:hidden}
.score-bar-fill{height:100%;border-radius:6px;background:linear-gradient(90deg,#e94560,#1a1a2e)}
.summary-note{margin-top:20px;padding:14px 18px;background:#f9fafb;border-left:4px solid #e94560;border-radius:8px;font-size:11px;color:#374151;line-height:1.7}

/* Remediation effort + Priority fixes */
.effort-row{display:flex;align-items:center;gap:10px;margin:20px 0 8px}
.effort-label{font-size:12px;font-weight:600;color:#374151}
.effort-badge{display:inline-block;padding:4px 14px;border-radius:20px;font-size:11px;font-weight:700;color:#fff}
.effort-detail{font-size:11px;color:#6b7280;margin-bottom:20px}

.priority-title-row{font-size:13px;font-weight:700;color:#1a1a2e;margin-bottom:12px}
.pfix{display:flex;align-items:flex-start;gap:10px;padding:12px 0;border-bottom:1px solid #f3f4f6}
.pfix-num{display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:#1a1a2e;color:#fff;font-size:10px;font-weight:700;flex-shrink:0;margin-top:2px}
.pfix-body{flex:1}
.pfix-header{display:flex;align-items:center;gap:8px;margin-bottom:4px}
.pfix-badge{display:inline-block;padding:2px 7px;border-radius:3px;font-size:9px;font-weight:700;color:#fff;letter-spacing:.6px}
.pfix-title{font-size:12px;font-weight:700;color:#1a1a2e}
.pfix-detail{font-size:11px;color:#6b7280;line-height:1.5}

/* ── Compliance Dashboard ── */
.comp-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.comp-card{border:1px solid #e5e7eb;border-radius:10px;padding:22px;text-align:center}
.comp-icon{font-size:20px;margin-bottom:10px;color:#1a1a2e}
.comp-title{font-size:12px;font-weight:700;color:#1a1a2e;margin-bottom:12px}
.comp-badge{display:inline-block;padding:5px 16px;border-radius:20px;font-size:11px;font-weight:700;color:#fff;margin-bottom:10px}
.comp-detail{font-size:11px;color:#6b7280;line-height:1.55}

/* ── Findings ── */
.sev-section{margin-bottom:26px}
.sev-header{display:flex;align-items:center;gap:10px;padding:9px 13px;background:#f9fafb;border-radius:7px;margin-bottom:10px}
.sev-badge{display:inline-block;padding:2px 9px;border-radius:4px;font-size:9px;font-weight:700;color:#fff;letter-spacing:.8px}
.sev-count{font-size:11px;color:#6b7280;font-weight:600}
.issue-card{border:1px solid #e5e7eb;border-radius:9px;padding:14px 16px;margin-bottom:10px}
.issue-row{display:flex;align-items:flex-start;gap:8px;margin-bottom:10px}
.issue-num{font-size:9px;font-weight:700;color:#9ca3af;margin-top:3px;min-width:20px}
.issue-title{font-size:13px;font-weight:700;color:#1a1a2e;flex:1}
.affected-badge{font-size:9px;color:#6b7280;background:#f3f4f6;padding:2px 7px;border-radius:4px;white-space:nowrap}

/* Explanation grid inside issue card */
.expl-wrap{display:block}
.expl-wrap.has-shot{display:grid;grid-template-columns:1fr 180px;gap:14px}
.expl-col{display:flex;flex-direction:column;gap:7px}
.expl-block{}
.expl-lbl{display:block;font-size:9px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;margin-bottom:2px}
.expl-txt{font-size:11px;color:#4b5563;line-height:1.55}
.expl-code{font-family:'Courier New',monospace;font-size:9.5px;color:#1a1a2e;background:#f3f4f6;padding:8px 10px;border-radius:5px;white-space:pre-wrap;line-height:1.5;overflow-x:auto}
.shot-col{display:flex;flex-direction:column;gap:4px}
.elem-thumb{max-width:100%;border:1px solid #e5e7eb;border-radius:6px;display:block}
.no-issues{text-align:center;color:#6b7280;font-style:italic;padding:40px}

/* ── Business Impact ── */
.impact-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:18px}
.impact-card{border:1px solid #e5e7eb;border-radius:10px;padding:18px}
.impact-icon{font-size:20px;margin-bottom:9px}
.impact-title{font-size:12px;font-weight:700;color:#1a1a2e;margin-bottom:6px}
.impact-text{font-size:11px;color:#4b5563;line-height:1.6}
.impact-note{padding:14px 18px;background:#fff7ed;border-left:4px solid #ea580c;border-radius:8px;font-size:11px;color:#374151;line-height:1.7}

/* ── Next Steps ── */
.step-list{list-style:none}
.step-item{display:flex;align-items:flex-start;gap:11px;padding:13px 0;border-bottom:1px solid #f3f4f6;font-size:12px;color:#374151}
.step-num{display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:#1a1a2e;color:#fff;font-size:10px;font-weight:700;flex-shrink:0;margin-top:1px}
.step-detail{font-size:11px;color:#6b7280;margin-top:3px;line-height:1.5}

/* ── Statement Template ── */
.statement-box{border:2px dashed #e5e7eb;border-radius:10px;padding:26px 30px;background:#f9fafb;font-size:12px;line-height:1.9;color:#374151}
.ph{background:#e94560;color:#fff;padding:1px 5px;border-radius:3px;font-weight:600;font-size:10px}
.stmt-section{font-size:12px;font-weight:700;color:#1a1a2e;margin:13px 0 3px}
.footer-note{text-align:center;font-size:10px;color:#9ca3af;margin-top:36px;padding-top:14px;border-top:1px solid #f3f4f6}
</style>
</head>
<body>

<!-- ══════════════════════════════════════════
     COVER PAGE
══════════════════════════════════════════ -->
<div class="cover page">
  <div class="cover-eyebrow">Accessibility Audit Report</div>
  <div class="cover-logo">Audit<span>Pilot</span></div>
  <div class="cover-tagline">Generate Client-Ready Reports in 2 Minutes</div>
  <div class="cover-divider"></div>

  <div class="cover-url">${escapeHtml(url)}</div>
  <div class="cover-date">Scanned on ${scanDate}</div>

  <div class="scores-row">
    <!-- Accessibility Score -->
    <div style="display:flex;flex-direction:column;align-items:center;gap:8px">
      <div class="score-ring">
        <div class="score-num">${score}</div>
        <div class="score-denom">/ 100</div>
      </div>
      <div class="score-label">Accessibility Score</div>
      <span class="status-pill" style="background:${statusColor}">${statusLabel}</span>
    </div>

    <!-- Divider -->
    <div style="width:1px;height:100px;background:rgba(255,255,255,.15);align-self:center"></div>

    <!-- EAA Readiness Score -->
    <div class="eaa-block">
      <div class="eaa-ring" style="border-color:${eaaColor};background:${eaaBg}">
        <div class="eaa-num">${eaaScore}</div>
        <div class="eaa-denom">/ 100</div>
      </div>
      <div class="score-label">EAA Readiness</div>
      <span class="eaa-risk-pill" style="background:${eaaColor}">${eaaRisk}</span>
    </div>
  </div>

  ${screenshotUri ? `
  <div class="cover-screenshot">
    <img src="${screenshotUri}" alt="Screenshot of ${escapeHtml(url)}">
  </div>
  <div class="cover-screenshot-lbl">Website screenshot captured during audit</div>` : ''}
</div>

<!-- ══════════════════════════════════════════
     EXECUTIVE SUMMARY
══════════════════════════════════════════ -->
<div class="content page">
  <div class="page-hdr">
    <span class="page-hdr-brand">AUDITPILOT</span>
    <span class="page-hdr-url">${escapeHtml(url)}</span>
  </div>

  <h2 class="sec-title">Executive Summary</h2>
  <p class="sec-sub">Overview of accessibility findings from the automated scan conducted on ${scanDate}.</p>

  <div class="summary-grid">
    <div class="s-card dark">
      <div class="s-num">${score}</div>
      <div class="s-lbl">Accessibility Score</div>
    </div>
    <div class="s-card" style="border-left:3px solid ${eaaColor}">
      <div class="s-num" style="color:${eaaColor}">${eaaScore}</div>
      <div class="s-lbl">EAA Readiness</div>
    </div>
    <div class="s-card">
      <div class="s-num" style="color:#1a1a2e">${totalIssues}</div>
      <div class="s-lbl">Total Issues</div>
    </div>
    <div class="s-card critical">
      <div class="s-num">${counts.critical}</div>
      <div class="s-lbl">Critical</div>
    </div>
    <div class="s-card serious">
      <div class="s-num">${counts.serious}</div>
      <div class="s-lbl">Serious</div>
    </div>
    <div class="s-card moderate">
      <div class="s-num">${counts.moderate}</div>
      <div class="s-lbl">Moderate</div>
    </div>
  </div>

  <div class="score-bar-wrap">
    <div class="score-bar-label"><span>Accessibility Score</span><span>${score} / 100</span></div>
    <div class="score-bar-track"><div class="score-bar-fill" style="width:${score}%"></div></div>
  </div>

  <!-- Remediation Effort -->
  <div class="effort-row">
    <span class="effort-label">Estimated Remediation Effort:</span>
    <span class="effort-badge" style="background:${effort.color}">${effort.label}</span>
  </div>
  <p class="effort-detail">${escapeHtml(effort.detail)}</p>

  <!-- Priority Fixes -->
  ${priorityFixes.length > 0 ? `
  <div class="priority-title-row">Priority Fixes Required</div>
  ${prioritySection}` : ''}

  <div class="summary-note">
    This report was generated using axe-core against WCAG 2.0 A/AA and WCAG 2.1 A/AA standards.
    ${totalIssues > 0
      ? `The scan identified <strong>${totalIssues} issue${totalIssues !== 1 ? 's' : ''}</strong>. EAA readiness score: <strong style="color:${eaaColor}">${eaaScore}/100 — ${eaaRisk}</strong>.`
      : `<strong style="color:#16a34a">No accessibility violations detected.</strong> EAA readiness score: <strong>${eaaScore}/100 — ${eaaRisk}</strong>.`}
    ${counts.critical > 0 ? `<strong style="color:#dc2626"> Immediate action required — ${counts.critical} critical issue${counts.critical !== 1 ? 's' : ''} found.</strong>` : ''}
  </div>
</div>

<!-- ══════════════════════════════════════════
     COMPLIANCE DASHBOARD
══════════════════════════════════════════ -->
<div class="content page">
  <div class="page-hdr">
    <span class="page-hdr-brand">AUDITPILOT</span>
    <span class="page-hdr-url">${escapeHtml(url)}</span>
  </div>

  <h2 class="sec-title">Compliance Overview</h2>
  <p class="sec-sub">WCAG 2.1 AA alignment, European Accessibility Act readiness, and estimated legal risk level.</p>

  ${compSection}
</div>

<!-- ══════════════════════════════════════════
     FINDINGS
══════════════════════════════════════════ -->
<div class="content page">
  <div class="page-hdr">
    <span class="page-hdr-brand">AUDITPILOT</span>
    <span class="page-hdr-url">${escapeHtml(url)}</span>
  </div>

  <h2 class="sec-title">Accessibility Findings</h2>
  <p class="sec-sub">All identified issues grouped by severity, each with structured explanations, fix guidance, and developer examples.</p>

  ${findSection}
</div>

<!-- ══════════════════════════════════════════
     BUSINESS IMPACT
══════════════════════════════════════════ -->
<div class="content page">
  <div class="page-hdr">
    <span class="page-hdr-brand">AUDITPILOT</span>
    <span class="page-hdr-url">${escapeHtml(url)}</span>
  </div>

  <h2 class="sec-title">Business Impact</h2>
  <p class="sec-sub">Understanding the consequences of unresolved accessibility barriers.</p>

  <div class="impact-grid">
    <div class="impact-card">
      <div class="impact-icon">&#128101;</div>
      <div class="impact-title">User Accessibility Barriers</div>
      <div class="impact-text">
        ${totalIssues === 0
          ? 'No accessibility barriers detected. The automated scan found no issues that would prevent users relying on screen readers, keyboard navigation, voice control, or other assistive technologies from accessing this website.'
          : `Approximately 1 in 6 people globally live with some form of disability. The ${totalIssues} issues identified may create significant barriers for users relying on screen readers, keyboard navigation, voice control, or other assistive technologies.`}
      </div>
    </div>
    <div class="impact-card">
      <div class="impact-icon">&#9878;</div>
      <div class="impact-title">Legal &amp; Compliance Risk</div>
      <div class="impact-text">
        The European Accessibility Act (EAA) and WCAG 2.1 AA require websites to be accessible.
        This site's EAA readiness score of <strong>${eaaScore}/100</strong> indicates
        <strong style="color:${eaaColor}">${eaaRisk}</strong> exposure.
        ${counts.critical > 0 ? 'Critical violations require immediate remediation to reduce regulatory liability.' : 'No critical violations were detected.'}
      </div>
    </div>
    <div class="impact-card">
      <div class="impact-icon">&#128200;</div>
      <div class="impact-title">Revenue &amp; Conversion Impact</div>
      <div class="impact-text">
        Inaccessible websites lose customers. Users who encounter barriers during navigation,
        form completion, or checkout are more likely to abandon the site. Resolving these issues
        can directly improve conversion rates and expand the addressable market.
      </div>
    </div>
    <div class="impact-card">
      <div class="impact-icon">&#128269;</div>
      <div class="impact-title">SEO &amp; Performance Benefits</div>
      <div class="impact-text">
        Many accessibility improvements — semantic HTML, proper heading structure, descriptive
        alt text, and meaningful link text — directly improve search engine indexing.
        Fixing these issues delivers both accessibility and organic search gains simultaneously.
      </div>
    </div>
  </div>

  <div class="impact-note">
    <strong>Bottom line:</strong> Accessibility investment delivers measurable ROI through expanded
    user reach, reduced legal exposure, improved SEO, and stronger brand reputation.
    Accessibility is not a compliance checkbox — it is a quality signal that demonstrates care for every user.
  </div>
</div>

<!-- ══════════════════════════════════════════
     RECOMMENDED NEXT STEPS
══════════════════════════════════════════ -->
<div class="content page">
  <div class="page-hdr">
    <span class="page-hdr-brand">AUDITPILOT</span>
    <span class="page-hdr-url">${escapeHtml(url)}</span>
  </div>

  <h2 class="sec-title">Recommended Next Steps</h2>
  <p class="sec-sub">A prioritised remediation plan to systematically resolve accessibility issues.</p>

  <ul class="step-list">${stepsSection}</ul>
</div>

<!-- ══════════════════════════════════════════
     ACCESSIBILITY STATEMENT TEMPLATE
══════════════════════════════════════════ -->
<div class="content">
  <div class="page-hdr">
    <span class="page-hdr-brand">AUDITPILOT</span>
    <span class="page-hdr-url">${escapeHtml(url)}</span>
  </div>

  <h2 class="sec-title">Accessibility Statement Template</h2>
  <p class="sec-sub">A ready-to-publish statement. Replace <span style="background:#e94560;color:#fff;padding:1px 5px;border-radius:3px;font-size:9px;font-weight:700">highlighted placeholders</span> before publishing.</p>

  <div class="statement-box">
    <div class="stmt-section">Accessibility Statement for <span class="ph">[COMPANY NAME]</span></div>
    <p><span class="ph">[COMPANY NAME]</span> is committed to ensuring digital accessibility for people with disabilities.
    We are continually improving the user experience for everyone and applying relevant accessibility standards.</p>

    <div class="stmt-section">Conformance Status</div>
    <p>The Web Content Accessibility Guidelines (WCAG) define requirements for designers and developers to improve
    accessibility for people with disabilities. Our website <span class="ph">[WEBSITE URL]</span> is currently
    working towards conformance with WCAG 2.1 Level AA.</p>

    <div class="stmt-section">Feedback</div>
    <p>We welcome feedback on the accessibility of <span class="ph">[WEBSITE URL]</span>:</p>
    <ul style="padding-left:18px;margin:6px 0;line-height:2">
      <li>Email: <span class="ph">[ACCESSIBILITY EMAIL]</span></li>
      <li>Phone: <span class="ph">[PHONE NUMBER]</span></li>
      <li>Post: <span class="ph">[POSTAL ADDRESS]</span></li>
    </ul>
    <p>We aim to respond within 2 business days.</p>

    <div class="stmt-section">Assessment Approach</div>
    <p><span class="ph">[COMPANY NAME]</span> assessed this website using AuditPilot and axe-core on ${scanDate}.
    Accessibility score: <strong>${score}/100</strong>. EAA readiness: <strong>${eaaScore}/100 (${eaaRisk})</strong>.
    ${totalIssues} issue${totalIssues !== 1 ? 's' : ''} identified.</p>

    <p style="margin-top:14px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:10px;color:#9ca3af">
      Prepared on <span class="ph">[DATE]</span>. Last reviewed on <span class="ph">[REVIEW DATE]</span>.
    </p>
  </div>

  <div class="footer-note">
    Generated by ${agencyName} v${version} &bull; axe-core &bull; ${scanDate} &bull;
    Scan duration: ${duration}s &bull; Pages scanned: ${pagesScanned} &bull;
    ${escapeHtml(url)}
  </div>
</div>

</body>
</html>`;
}

// ── Main export ────────────────────────────────────────────────────────────────

async function generateReport(url, scanResults) {
  let browser = null;

  try {
    const timestamp = Date.now();
    const domain    = new URL(url).hostname.replace(/[^a-z0-9]/gi, '-');
    const pdfName   = `auditpilot-${domain}-${timestamp}.pdf`;
    const pdfPath   = path.join(__dirname, 'reports', pdfName);

    const htmlContent = buildReportHtml(url, scanResults);

    browser = await chromium.launch({
      executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
      headless: true,
      timeout: 60000,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process'
      ]
    });

    const context = await browser.newContext();
    const page    = await context.newPage();
    await page.setContent(htmlContent, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' }
    });

    await browser.close();
    browser = null;

    return pdfPath;

  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    throw new Error(`PDF generation failed: ${error.message}`);
  }
}

module.exports = { generateReport };

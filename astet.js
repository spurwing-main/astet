function main() {
	function clickToCopy() {
		const HANDLE_CLASS = "u-click-copy";
		const COPIED_TEXT = "Copied!";
		const FEEDBACK_MS = 1100;

		function normalizeCopyValue(href) {
			if (!href) return "";
			const raw = String(href).trim();
			const lower = raw.toLowerCase();

			function stripAfterDelimiters(value, delimiters) {
				let out = value;
				delimiters.forEach((d) => {
					const idx = out.indexOf(d);
					if (idx !== -1) out = out.slice(0, idx);
				});
				return out;
			}

			if (lower.startsWith("mailto:")) {
				const withoutScheme = raw.slice("mailto:".length);
				const stripped = stripAfterDelimiters(withoutScheme, ["?", "#"]);
				try {
					return decodeURIComponent(stripped);
				} catch {
					return stripped;
				}
			}

			if (lower.startsWith("tel:")) {
				const withoutScheme = raw.slice("tel:".length);
				const stripped = stripAfterDelimiters(withoutScheme, ["?", "#", ";"]);
				try {
					return decodeURIComponent(stripped);
				} catch {
					return stripped;
				}
			}

			if (lower.startsWith("sms:")) {
				const withoutScheme = raw.slice("sms:".length);
				const stripped = stripAfterDelimiters(withoutScheme, ["?", "#", ";"]);
				try {
					return decodeURIComponent(stripped);
				} catch {
					return stripped;
				}
			}

			return raw;
		}

		async function copyTextToClipboard(text) {
			if (!text) return false;
			try {
				if (navigator.clipboard?.writeText && window.isSecureContext) {
					await navigator.clipboard.writeText(text);
					return true;
				}
			} catch {
				// fallback below
			}

			try {
				const ta = document.createElement("textarea");
				ta.value = text;
				ta.setAttribute("readonly", "");
				ta.style.position = "fixed";
				ta.style.left = "-9999px";
				ta.style.top = "0";
				ta.style.opacity = "0";
				document.body.appendChild(ta);
				ta.select();
				const ok = document.execCommand("copy");
				document.body.removeChild(ta);
				return ok;
			} catch {
				return false;
			}
		}

		function getLinkFromTrigger(triggerEl, clickTarget) {
			if (!triggerEl) return null;
			if (clickTarget?.closest) {
				const withinAnchor = clickTarget.closest("a[href]");
				if (withinAnchor && triggerEl.contains(withinAnchor)) return withinAnchor;
			}
			if (triggerEl.matches?.("a[href]")) return triggerEl;
			return null;
		}

		function ensureFeedbackUI(link) {
			if (!link || link.dataset.clickCopyUiReady === "1") return;
			link.dataset.clickCopyUiReady = "1";

			const originalWrap = document.createElement("span");
			originalWrap.dataset.clickCopyOriginal = "1";
			while (link.firstChild) originalWrap.appendChild(link.firstChild);

			const copiedWrap = document.createElement("span");
			copiedWrap.dataset.clickCopyCopied = "1";
			copiedWrap.setAttribute("aria-hidden", "true");
			copiedWrap.textContent = COPIED_TEXT;

			link.appendChild(originalWrap);
			link.appendChild(copiedWrap);

			// Keep layout stable: feedback swaps via opacity only.
			const computed = window.getComputedStyle(link);
			if (computed.position === "static") link.style.position = "relative";

			copiedWrap.style.position = "absolute";
			copiedWrap.style.inset = "0";
			copiedWrap.style.pointerEvents = "none";
			copiedWrap.style.opacity = "0";
			copiedWrap.style.display = "flex";
			copiedWrap.style.alignItems = "center";
			const ta = computed.textAlign;
			copiedWrap.style.justifyContent =
				ta === "center" ? "center" : ta === "right" ? "flex-end" : "flex-start";
			copiedWrap.style.whiteSpace = "nowrap";
			copiedWrap.style.color = "currentColor";
			copiedWrap.style.font = "inherit";
			copiedWrap.style.lineHeight = "inherit";
			copiedWrap.style.textDecoration = "inherit";
		}

		function showCopied(link) {
			if (!link) return;
			ensureFeedbackUI(link);

			const originalWrap = link.querySelector("span[data-click-copy-original='1']");
			const copiedWrap = link.querySelector("span[data-click-copy-copied='1']");
			if (!originalWrap || !copiedWrap) return;

			// Allow repeated clicks without piling up timers/tweens.
			if (link._clickCopyTimeout) {
				clearTimeout(link._clickCopyTimeout);
				link._clickCopyTimeout = null;
			}

			const hasGsap = typeof window.gsap !== "undefined" && typeof window.gsap.to === "function";
			if (hasGsap) {
				gsap.killTweensOf([originalWrap, copiedWrap]);
				gsap.set(originalWrap, { autoAlpha: 1 });
				gsap.set(copiedWrap, { autoAlpha: 0 });
				gsap.to(originalWrap, { duration: 0.12, autoAlpha: 0, ease: "sine.inOut" });
				gsap.to(copiedWrap, { duration: 0.12, autoAlpha: 1, ease: "sine.inOut" });
				link._clickCopyTimeout = setTimeout(() => {
					gsap.to(copiedWrap, { duration: 0.2, autoAlpha: 0, ease: "sine.inOut" });
					gsap.to(originalWrap, { duration: 0.2, autoAlpha: 1, ease: "sine.inOut" });
					link._clickCopyTimeout = null;
				}, FEEDBACK_MS);
				return;
			}

			// Non-GSAP fallback: immediate swap, then revert.
			originalWrap.style.opacity = "0";
			copiedWrap.style.opacity = "1";
			link._clickCopyTimeout = setTimeout(() => {
				copiedWrap.style.opacity = "0";
				originalWrap.style.opacity = "1";
				link._clickCopyTimeout = null;
			}, FEEDBACK_MS);
		}

		const onClick = async (e) => {
			// Let users keep normal behavior for modified clicks (new tab, etc.)
			if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
			if (e.button !== 0) return; // left click only

			const trigger = e.target?.closest?.(`.${HANDLE_CLASS}`);
			if (!trigger) return;
			const link = getLinkFromTrigger(trigger, e.target);
			if (!link) return;

			// Only intercept tel/email/sms links. Leave normal URLs alone.
			const rawHrefAttr = link.getAttribute("href") || "";
			const rawHref = rawHrefAttr || link.href || "";
			const lowerHref = String(rawHref).trim().toLowerCase();
			const isHandled =
				lowerHref.startsWith("mailto:") ||
				lowerHref.startsWith("tel:") ||
				lowerHref.startsWith("sms:");
			if (!isHandled) return;

			const valueToCopy = normalizeCopyValue(rawHref);
			if (!valueToCopy) return;

			e.preventDefault();
			const ok = await copyTextToClipboard(valueToCopy);
			if (ok) showCopied(link);
		};

		document.addEventListener("click", onClick, { passive: false });

		// Return a cleanup function for page transitions, if ever needed.
		return () => document.removeEventListener("click", onClick);
	}

	function homeCarousel() {
		// get section and list
		const section = document.querySelector(".c-home-carousel");
		if (!section) return;
		const listEl = section.querySelector(".home-carousel_list");
		if (!listEl) return;

		// add a "loading" class immediately
		document.documentElement.classList.add("home-carousel-loading");

		let didSetReadyClasses = false;
		function setCarouselReady(reason) {
			if (didSetReadyClasses) return;
			didSetReadyClasses = true;
			document.documentElement.classList.remove("home-carousel-loading");
			document.documentElement.classList.add("home-carousel-loaded");
			if (reason) console.log("homeCarousel ready:", reason);
		}

		// If there are no slides, Keen's `created` callback may never fire.
		// Fail open: toggle classes so the page doesn't stay in a loading state.
		const slideCount = listEl.querySelectorAll(".home-carousel_slide").length;
		if (!slideCount) {
			setCarouselReady("no-slides");
			return;
		}

		let started = false;
		let activeNameIndex = null;

		function startCarousel() {
			if (started) return;
			started = true;

			initKeen();
		}

		// fallback if imagesLoaded doesnt exist
		if (!astet.hasImagesLoaded) {
			startCarousel();
		} else {
			const imgLoad = imagesLoaded(listEl, { background: true });
			imgLoad.on("always", () => startCarousel());
			setTimeout(() => startCarousel(), 2500); // timeout fallback if image load takes too long
		}

		function initKeen() {
			const DURATION = 1;
			const DURATION_MS = DURATION * 1000;
			const power3InOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
			const opacityScalingFactor = 1.1;

			if (typeof window.KeenSlider === "undefined") {
				setCarouselReady("keen-missing");
				return;
			}

			let slider;
			try {
				slider = new KeenSlider(
					listEl,
					{
						loop: true,
						selector: ".home-carousel_slide",
						defaultAnimation: {
							duration: DURATION_MS,
							easing: power3InOut,
						},
						drag: true,
						dragSpeed: 0.75,
						detailsChanged: (s) => {
							s.slides.forEach((slide, idx) => {
								const overlay = slide.querySelector(".home-carousel_slide-overlay");
								if (overlay) {
									overlay.style.opacity = Math.min(
										1,
										opacityScalingFactor * (1 - s.track.details.slides[idx].portion),
									);
								}
							});
						},
						created: (s) => {
							initControls(s);
							updateNameWithFade(s); // set initial name
							setCarouselReady("keen-created");
						},

						slideChanged: (s) => {
							updateNameWithFade(s); // update after next/prev (and drag) actually changes slide
						},
					},
					[],
				);
			} catch (e) {
				console.warn("homeCarousel: KeenSlider init failed", e);
				setCarouselReady("keen-init-failed");
				return;
			}

			// Safety net: if Keen never calls `created`, don't keep the page "loading".
			setTimeout(() => setCarouselReady("created-timeout"), 1000);

			astet.slider = slider;
		}

		function initControls(s) {
			const prevBtn = document.querySelector("button.home-carousel_btn.is-prev");
			const nextBtn = document.querySelector("button.home-carousel_btn.is-next");
			if (!prevBtn || !nextBtn) return;

			prevBtn.addEventListener("click", () => s.prev());
			nextBtn.addEventListener("click", () => s.next());
		}

		function updateName(s) {
			const nameEl = document.querySelector(".home-carousel_name");
			if (!nameEl) return;

			// rel is the current visible slide index (relative). Works nicely with loop.
			const rel = s.track.details.rel;
			const slideEl = s.slides[rel];
			const projectName = slideEl?.dataset?.projectName ?? "";
			const projectLocation = slideEl?.dataset?.projectLocation ?? "";
			const newName = projectLocation ? `${projectName}, ${projectLocation}` : projectName;
			console.log("Updating name to:", newName);
			gsap.to(nameEl, {
				duration: 1,
				ease: "power3.inOut",
				text: { value: newName, delimiter: "", speed: 2.5 },
			});
		}

		function updateNameWithFade(s) {
			const nameListWrap = document.querySelector(".home-carousel_name-list-wrap");
			const nameList = document.querySelector(".home-carousel_name-list");
			if (!nameListWrap || !nameList) return;

			const wraps = Array.from(nameList.querySelectorAll(".home-carousel_name-wrap"));
			if (!wraps.length) return;

			const rel = s.track.details.rel;
			const incoming = wraps[rel];
			if (!incoming) return;

			const currentIndex = activeNameIndex ?? 0;
			const outgoing = wraps[currentIndex] || wraps[0];

			const showWrapAtIndex = (activeIdx) => {
				wraps.forEach((wrap, idx) => {
					const isActive = idx === activeIdx;
					wrap.classList.remove("is-active");
					wrap.setAttribute("aria-hidden", String(!isActive));
					gsap.set(wrap, {
						clearProps: "position,left,top,xPercent,width,visibility",
						display: isActive ? "block" : "none",
						autoAlpha: 1,
					});
				});
				activeNameIndex = activeIdx;
			};

			const measureWidth = (wrap) => {
				const previousStyle = wrap.getAttribute("style");
				gsap.set(wrap, {
					display: "block",
					position: "absolute",
					visibility: "hidden",
					left: "50%",
					xPercent: -50,
					top: 0,
					autoAlpha: 1,
				});
				const width = wrap.offsetWidth;
				if (previousStyle === null) wrap.removeAttribute("style");
				else wrap.setAttribute("style", previousStyle);
				return width;
			};

			if (!nameList.dataset.homeCarouselNameReady) {
				showWrapAtIndex(rel);
				nameList.dataset.homeCarouselNameReady = "1";
				return;
			}

			if (incoming === outgoing) {
				showWrapAtIndex(rel);
				return;
			}

			if (nameListWrap._homeCarouselNameTimeline) {
				nameListWrap._homeCarouselNameTimeline.kill();
				nameListWrap._homeCarouselNameTimeline = null;
				if (activeNameIndex !== null) showWrapAtIndex(activeNameIndex);
			}

			gsap.killTweensOf([nameListWrap, nameList, ...wraps]);

			const currentWidth = outgoing ? outgoing.offsetWidth : nameListWrap.offsetWidth;
			const incomingWidth = measureWidth(incoming);

			showWrapAtIndex(currentIndex);
			gsap.set(nameListWrap, { width: currentWidth });
			gsap.set(nameList, {
				position: "relative",
				height: Math.max(outgoing.offsetHeight, incoming.offsetHeight),
			});
			gsap.set([outgoing, incoming], {
				display: "block",
				position: "absolute",
				left: "50%",
				xPercent: -50,
				top: 0,
				width: "max-content",
			});
			gsap.set(outgoing, { autoAlpha: 1 });
			gsap.set(incoming, { autoAlpha: 0 });

			const tl = gsap.timeline({
				defaults: { duration: 0.45, ease: "power1.inOut" },
				onComplete: () => {
					showWrapAtIndex(rel);
					gsap.set(nameListWrap, { clearProps: "width" });
					gsap.set(nameList, { clearProps: "position,height" });
					nameListWrap._homeCarouselNameTimeline = null;
				},
			});
			nameListWrap._homeCarouselNameTimeline = tl;
			tl.to(incoming, { autoAlpha: 1 });
			tl.to(outgoing, { autoAlpha: 0 }, 0);
			tl.to(nameListWrap, { width: incomingWidth }, 0);
		}

		// remove .css-home-carousel-temp element if exists
		const tempEl = document.querySelector(".css-home-carousel-temp");
		if (tempEl) tempEl.parentElement.removeChild(tempEl);
	}

	function loadCardsOnScroll() {
		// for each .c-cols-section, create a scrolltrigger that fades in each .c-card inside it with a stagger
		const sections = document.querySelectorAll(".anim-load-trigger");
		sections.forEach((section) => {
			const cards = section.querySelectorAll(".c-card, .anim-load-item");
			if (!cards.length) return;

			gsap.to(cards, {
				scrollTrigger: {
					trigger: section,
					start: "top 80%",
				},
				autoAlpha: 1,
				y: 0,
				duration: 0.5,
				ease: "sine.inOut",
				stagger: 0.15,
				onComplete: () => {
					console.log("Loaded cards in section:", section);
				},
			});
		});

		// batch
		ScrollTrigger.batch(".anim-load-batch-trigger :is(.c-card, .anim-load-item)", {
			onEnter: (batch) =>
				gsap.to(batch, { autoAlpha: 1, y: 0, duration: 0.5, ease: "sine.inOut", stagger: 0.15 }),
			start: "top 95%",
		});

		// click events on any filter controls will immediately set autoAlpha and y to 1 and 0 respectively, to ensure they are visible if user filters before scroll
		// filter controls are .checkbox_label
		const filterControls = document.querySelectorAll(".checkbox_label");
		filterControls.forEach((control) => {
			control.addEventListener("click", () => {
				const cards = document.querySelectorAll(".c-card, .anim-load-item");
				gsap.set(cards, { autoAlpha: 1, y: 0 });
			});
		});

		/* add .filter-list-loaded class to html when a filter control is clicked for the first time (otherwise FS render events fire twice on page load causing flashing) */
		let filterListLoaded = false;
		filterControls.forEach((control) => {
			control.addEventListener("click", () => {
				if (!filterListLoaded) {
					document.documentElement.classList.add("filter-list-loaded");
					filterListLoaded = true;
				}
			});
		});
	}

	function finsweetScrollTriggerRefresh() {
		if (window._astetFsScrollTriggerRefreshHooked) return;
		window._astetFsScrollTriggerRefreshHooked = true;

		const refreshSoon = () => {
			console.log("Finsweet list rendered/updated, refreshing ScrollTrigger...");
			if (typeof window.ScrollTrigger === "undefined") return;
			if (typeof ScrollTrigger.refresh !== "function") return;
			// Defer to ensure DOM/layout has settled after Finsweet renders.
			requestAnimationFrame(() => setTimeout(() => ScrollTrigger.refresh(), 0));
		};

		window.FinsweetAttributes ||= [];
		window.FinsweetAttributes.push([
			"list",
			(listInstances) => {
				(listInstances || []).forEach((listInstance) => {
					if (!listInstance || typeof listInstance.addHook !== "function") return;
					listInstance.addHook("afterRender", () => refreshSoon());
				});

				// Run once on init, too.
				refreshSoon();
			},
		]);
	}

	function injectExternalLinkIcons() {
		const containers = document.querySelectorAll(".proj-intro_details");
		if (!containers.length) return;

		const SVG_NS = "http://www.w3.org/2000/svg";

		function isExternalLink(anchor) {
			if (!anchor) return false;
			const hrefAttr = anchor.getAttribute("href");
			if (!hrefAttr) return false;

			const href = hrefAttr.trim();
			if (!href) return false;
			if (
				href.startsWith("#") ||
				href.startsWith("mailto:") ||
				href.startsWith("tel:") ||
				href.startsWith("sms:") ||
				href.startsWith("javascript:")
			)
				return false;

			try {
				const url = new URL(href, window.location.href);
				if (url.protocol !== "http:" && url.protocol !== "https:") return false;
				return url.origin !== window.location.origin;
			} catch {
				return false;
			}
		}

		function buildIcon() {
			const iconWrap = document.createElement("span");
			iconWrap.className = "u-ext-link-icon";
			iconWrap.setAttribute("aria-hidden", "true");
			iconWrap.dataset.extLinkIcon = "1";
			iconWrap.style.display = "inline-flex";
			iconWrap.style.marginLeft = "0.35em";
			iconWrap.style.lineHeight = "1";

			const svg = document.createElementNS(SVG_NS, "svg");
			svg.setAttribute("width", "10");
			svg.setAttribute("height", "10");
			svg.setAttribute("viewBox", "0 0 10 10");
			svg.setAttribute("fill", "none");
			svg.setAttribute("xmlns", SVG_NS);

			const path = document.createElementNS(SVG_NS, "path");
			path.setAttribute(
				"d",
				"M7.62733 1.52654C6.98463 1.47 6.17226 1.26955 5.19022 0.925169L5.74551 0.370053C7.16973 0.488272 8.43456 0.364913 9.53999 -2.36877e-05L9.81764 0.277534C9.45259 1.38262 9.32919 2.64705 9.44745 4.07082L8.89216 4.62594C8.54767 3.64421 8.34715 2.83209 8.29059 2.1896L0.663067 9.81472L-0.000196171 9.15167L7.62733 1.52654Z",
			);
			path.setAttribute("fill", "currentColor");

			svg.appendChild(path);
			iconWrap.appendChild(svg);
			return iconWrap;
		}

		containers.forEach((container) => {
			const links = container.querySelectorAll("a[href]");
			links.forEach((link) => {
				if (!isExternalLink(link)) return;

				const nextEl = link.nextElementSibling;
				if (nextEl?.dataset?.extLinkIcon === "1") return;
				if (link.dataset.extLinkIconInjected === "1") return;

				link.insertAdjacentElement("afterend", buildIcon());
				link.dataset.extLinkIconInjected = "1";
			});
		});
	}

	function nav_openClose() {
		const MOBILE_PORTRAIT_QUERY = "(max-width: 479px)";

		const navBtns = gsap.utils.toArray(".nav_mobile-btn");
		if (!navBtns.length) return;
		if (typeof window.gsap === "undefined") return;

		const mql =
			typeof window.matchMedia === "function" ? window.matchMedia(MOBILE_PORTRAIT_QUERY) : null;

		let cleanup = null;
		let open = false;

		function setup() {
			if (cleanup) return;

			const navEl = document.querySelector(".nav:not(.is-home-bar)");
			if (!navEl) return;

			const homeFakeNav = document.querySelector(".nav.is-home-bar"); // this is the logo and button shown on the home page in an open state
			const isHomePage = Boolean(homeFakeNav);

			const menuWrap = navEl.querySelector(".nav_menu-outer-wrap");
			const menuBg = navEl.querySelector(".nav_menu-bg");
			const menuInner = navEl.querySelector(".nav_menu-inner-wrap");
			const menuLinks = Array.from(navEl.querySelectorAll(".nav_menu-link"));
			const socials = navEl.querySelector(".nav_socials");

			if (!menuWrap || !menuBg || !menuInner) return;

			open = false;
			astet.navOpen = false;
			document.documentElement.classList.remove("nav-open");
			navBtns.forEach((navBtn) => navBtn.setAttribute("aria-expanded", "false"));
			menuWrap.style.display = "none";

			gsap.set([menuBg, menuInner], { autoAlpha: 0 });
			if (menuLinks.length) gsap.set(menuLinks, { autoAlpha: 0 });
			if (socials) gsap.set(socials, { autoAlpha: 0 });

			const tl = gsap.timeline({
				paused: true,
				defaults: { duration: 0.5, ease: "sine.inOut" },
			});

			// Base fade-in
			tl.to(homeFakeNav, { display: "flex" }, 0);

			tl.to(
				[menuBg, menuInner, homeFakeNav],
				{ autoAlpha: 1, duration: 0.25, ease: "sine.inOut" },
				0,
			);

			// Link stagger + socials fade
			if (menuLinks.length) tl.to(menuLinks, { autoAlpha: 1, duration: 0.25, stagger: 0.03 }, 0.2);
			if (socials) tl.to(socials, { autoAlpha: 1, duration: 0.25 }, 0.22);

			tl.eventCallback("onReverseComplete", () => {
				menuWrap.style.display = "none";
			});

			const onClick = () => {
				open = !open;
				astet.navOpen = open;
				document.documentElement.classList.toggle("nav-open", open);
				navBtns.forEach((navBtn) => navBtn.setAttribute("aria-expanded", String(open)));

				if (open) {
					menuWrap.style.display = "flex";
					tl.play();
				} else {
					tl.reverse();
				}
			};

			navBtns.forEach((navBtn) => navBtn.addEventListener("click", onClick));

			cleanup = () => {
				navBtns.forEach((navBtn) => navBtn.removeEventListener("click", onClick));
				open = false;
				astet.navOpen = false;
				document.documentElement.classList.remove("nav-open");
				navBtns.forEach((navBtn) => navBtn.setAttribute("aria-expanded", "false"));
				menuWrap.style.display = "";
				tl.kill();
				gsap.set([menuBg, menuInner], { clearProps: "all" });
				if (menuLinks.length) gsap.set(menuLinks, { clearProps: "all" });
				if (socials) gsap.set(socials, { clearProps: "all" });
			};
		}

		function teardown() {
			if (!cleanup) return;
			cleanup();
			cleanup = null;
		}

		function syncToBreakpoint() {
			if (!mql || mql.matches) {
				setup();
			} else {
				teardown();
			}
		}

		syncToBreakpoint();

		if (mql) {
			if (typeof mql.addEventListener === "function")
				mql.addEventListener("change", syncToBreakpoint);
			else if (typeof mql.addListener === "function") mql.addListener(syncToBreakpoint);
		}

		return () => {
			teardown();
			if (!mql) return;
			if (typeof mql.removeEventListener === "function")
				mql.removeEventListener("change", syncToBreakpoint);
			else if (typeof mql.removeListener === "function") mql.removeListener(syncToBreakpoint);
		};
	}

	function nav_hideShow() {
		const nav = document.querySelector(".nav");
		if (!nav) return;
		if (typeof window.ScrollTrigger === "undefined" || typeof ScrollTrigger.create !== "function")
			return;

		// --- DEBUG LOGGING (enable with localStorage.setItem("astet:debugNav","1")) ---
		const DEBUG_NAV = (() => {
			try {
				return localStorage.getItem("astet:debugNav") === "1";
			} catch {
				return false;
			}
		})();
		const log = (...args) => {
			return; // disable all nav_hideShow logs (keep the function and calls in place for easy re-enabling when needed)
			if (!DEBUG_NAV) return;
			console.log("[nav_hideShow]", ...args);
		};

		const showThreshold = 10; // Always show when within this distance from top
		const hideThreshold = 60; // Can hide only after passing this
		const revealBuffer = 10; // Scroll-up distance before revealing
		const hideBuffer = 10; // Small buffer to prevent flicker

		let lastScrollY = window.scrollY;
		let currentScrollY = window.scrollY;
		let revealDistance = 0;
		let navHidden = false;
		let ticking = false;

		const isInPageVariant = nav.matches('[data-wf--nav--variant="in-page"]');
		let hideEnabled = !isInPageVariant;
		let armStartY = 0; // for in-page variant: scrollY where hide/show becomes active

		function setHideEnabled(enabled, reason) {
			const next = Boolean(enabled);
			if (hideEnabled === next) return;
			hideEnabled = next;
			nav.classList.toggle("is-hide-enabled", hideEnabled);
			log("hideEnabled", { hideEnabled, reason });

			if (!hideEnabled) armStartY = 0;

			// Reset scroll deltas so we don't immediately hide on the first armed frame.
			lastScrollY = window.scrollY;
			currentScrollY = window.scrollY;
			revealDistance = 0;

			if (!hideEnabled) {
				nav.classList.remove("is-hidden", "is-past-threshold");
				navHidden = false;
			}
		}

		// Track changes to reduce noisy logs
		let lastLog = {
			navHidden,
			isPast:
				hideEnabled &&
				(isInPageVariant ? currentScrollY - armStartY : currentScrollY) > hideThreshold,
			y: currentScrollY,
		};

		log("init", {
			showThreshold,
			hideThreshold,
			revealBuffer,
			hideBuffer,
			startY: currentScrollY,
			isInPageVariant,
		});

		// Clean up any existing trigger
		const oldTrigger = ScrollTrigger.getById("nav_hideShow");
		if (oldTrigger) {
			log("killing old ScrollTrigger#nav_hideShow");
			oldTrigger.kill();
		}

		const oldArmTrigger = ScrollTrigger.getById("nav_hideShow_arm");
		if (oldArmTrigger) {
			log("killing old ScrollTrigger#nav_hideShow_arm");
			oldArmTrigger.kill();
		}

		// For the "in-page" sticky nav variant, only start hide/show once the hero has
		// scrolled past the top of the viewport.
		if (isInPageVariant) {
			const candidateSelectors = [".c-home-carousel"];

			let heroEl = null;
			for (const sel of candidateSelectors) {
				try {
					const found = document.querySelector(sel);
					if (found) {
						heroEl = found;
						log("hero found", { selector: sel, heroEl });
						break;
					}
				} catch (e) {
					log("invalid hero selector", { selector: sel, error: String(e) });
				}
			}

			if (heroEl) {
				setHideEnabled(false, "init-in-page");
				ScrollTrigger.create({
					id: "nav_hideShow_arm",
					trigger: heroEl,
					start: "bottom top",
					end: "bottom top",
					onEnter(self) {
						armStartY = self?.start ?? window.scrollY;
						setHideEnabled(true, "hero-passed");
					},
					onLeaveBack: () => setHideEnabled(false, "hero-visible"),
					onRefresh(self) {
						// Ensure correct state after layout shifts / late-loading media.
						const y = window.scrollY;
						const armed = y >= self.start;
						if (armed) {
							armStartY = self.start;
							// Keep deltas stable if baseline shifts.
							lastScrollY = y;
							currentScrollY = y;
							revealDistance = 0;
						}
						setHideEnabled(armed, "refresh");
					},
				});
			} else {
				// Fail safe: if we can't find the hero, keep hide/show disabled for this variant.
				setHideEnabled(false, "no-hero");
				log("in-page variant: .c-home-carousel not found; hide/show will remain disabled", {
					candidateSelectors,
				});
			}
		} else {
			// Ensure class isn't left behind if markup changes.
			nav.classList.remove("is-hide-enabled");
		}

		// rAF update loop
		function updateNav() {
			ticking = false;

			const yRaw = currentScrollY;
			const delta = yRaw - lastScrollY;
			const y = isInPageVariant ? yRaw - armStartY : yRaw;
			const isPast = hideEnabled && y > hideThreshold;

			if (!hideEnabled) {
				// While the hero is still on-screen (in-page variant), keep nav in its static/sticky state.
				if (navHidden) {
					log("forced show (hide disabled)", { y });
					nav.classList.remove("is-hidden", "is-past-threshold");
					navHidden = false;
				}
				revealDistance = 0;
				lastScrollY = yRaw;
				return;
			}

			// Helpful “why didn’t it hide?” log (only when scrolling down past threshold)
			if (DEBUG_NAV && delta > 0 && isPast && !navHidden && delta <= hideBuffer) {
				log("not hiding (delta too small)", { y, lastScrollY, delta, hideBuffer });
			}

			// --- NAV VISIBILITY ---
			if (y <= showThreshold) {
				if (navHidden) {
					log("show (near top)", { y, showThreshold });
					nav.classList.remove("is-hidden", "is-past-threshold");
					navHidden = false;
				}
				revealDistance = 0;
			} else if (delta > hideBuffer && y > hideThreshold && !navHidden) {
				log("hide (scrolling down)", { y, lastScrollY, delta, hideBuffer });
				nav.classList.add("is-hidden", "is-past-threshold");
				navHidden = true;
				revealDistance = 0;
			} else if (delta < 0 && navHidden) {
				revealDistance -= delta; // delta is negative
				if (DEBUG_NAV) log("scrolling up while hidden", { y, delta, revealDistance, revealBuffer });
				if (revealDistance >= revealBuffer) {
					log("reveal (scrolled up enough)", { y, revealDistance, revealBuffer });
					nav.classList.remove("is-hidden");
					navHidden = false;
					revealDistance = 0;
				}
			}

			nav.classList.toggle("is-past-threshold", isPast);

			// Log state transitions (kept minimal)
			if (DEBUG_NAV) {
				const stateChanged =
					lastLog.navHidden !== navHidden ||
					lastLog.isPast !== isPast ||
					Math.abs(lastLog.y - y) >= 50;
				if (stateChanged) {
					log("state", { y, lastScrollY, delta, navHidden, isPast, revealDistance });
					lastLog = { navHidden, isPast, y };
				}
			}

			lastScrollY = yRaw;
		}

		// ScrollTrigger watches scroll and schedules an update
		ScrollTrigger.create({
			id: "nav_hideShow",
			start: 0,
			end: () => ScrollTrigger.maxScroll(window),
			invalidateOnRefresh: true,
			onUpdate(self) {
				currentScrollY = window.scrollY;

				if (DEBUG_NAV && self?.direction) {
					// direction: 1 down, -1 up
					log("onUpdate", { y: currentScrollY, direction: self.direction });
				}

				if (!ticking) {
					ticking = true;
					requestAnimationFrame(updateNav);
				}
			},
		});
	}

	function lazyLoadVideos() {
		ll = new LazyLoad({});
	}

	astet.hasImagesLoaded = typeof window.imagesLoaded === "function";
	clickToCopy();
	homeCarousel();
	loadCardsOnScroll();
	finsweetScrollTriggerRefresh();
	injectExternalLinkIcons();
	nav_openClose();
	nav_hideShow();
	lazyLoadVideos();
}

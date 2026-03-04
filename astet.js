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
			return triggerEl.querySelector?.("a[href]") ?? null;
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

		let started = false;

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

			const slider = new KeenSlider(
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
						updateName(s); // set initial name
						document.documentElement.classList.remove("home-carousel-loading");
						document.documentElement.classList.add("home-carousel-loaded");
					},

					slideChanged: (s) => {
						updateName(s); // update after next/prev (and drag) actually changes slide
					},
				},
				[],
			);

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
	}

	function mediaCardHover() {
		return; // replaced with CSS only hover effect for now.
		const mm = gsap.matchMedia();

		// Require real hover + fine pointer (typical desktop/laptop trackpad/mouse)
		mm.add("(min-width: 480px) and (hover: hover) and (pointer: fine)", () => {
			const cards = Array.from(document.querySelectorAll(".c-card"));
			const cleanups = [];

			cards.forEach((card) => {
				const caption_anim = card.querySelectorAll(".anim-caption-item");
				if (!caption_anim.length) return;

				const onEnter = () => {
					gsap.to(caption_anim, {
						autoAlpha: 1,
						y: 0,
						duration: 0.25,
						ease: "sine.inOut",
						stagger: 0.05,
					});
				};

				const onLeave = () => {
					gsap.to(caption_anim, {
						autoAlpha: 0,
						y: -5,
						duration: 0.2,
						ease: "sine.inOut",
						stagger: 0.05,
					});
				};

				card.addEventListener("mouseenter", onEnter);
				card.addEventListener("mouseleave", onLeave);

				cleanups.push(() => {
					card.removeEventListener("mouseenter", onEnter);
					card.removeEventListener("mouseleave", onLeave);
				});
			});

			// GSAP MatchMedia cleanup when query no longer matches
			return () => {
				cleanups.forEach((fn) => fn());
				// clear autoalpha and y
				gsap.set(".anim-caption-item", { clearProps: "all" });
			};
		});
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

		/* add .project-list-loaded class to html when a filter control is clicked for the first time (otherwise FS render events fire twice on page load causing flashing) */
		let projectListLoaded = false;
		filterControls.forEach((control) => {
			control.addEventListener("click", () => {
				if (!projectListLoaded) {
					document.documentElement.classList.add("project-list-loaded");
					projectListLoaded = true;
				}
			});
		});
	}

	/* TO DO - check if we still need this scroll trigger refresh now that we are using filter control clicks to set all cards visible		 */
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

	function navOpenClose() {
		const MOBILE_PORTRAIT_QUERY = "(max-width: 479px)";

		const navBtn = document.querySelector(".nav_mobile-btn");
		if (!navBtn) return;
		if (typeof window.gsap === "undefined") return;

		const mql =
			typeof window.matchMedia === "function" ? window.matchMedia(MOBILE_PORTRAIT_QUERY) : null;

		let cleanup = null;
		let open = false;

		function setup() {
			if (cleanup) return;

			const navEl = document.querySelector(".nav");
			if (!navEl) return;

			const menuWrap = navEl.querySelector(".nav_menu-outer-wrap");
			const menuBg = navEl.querySelector(".nav_menu-bg");
			const menuInner = navEl.querySelector(".nav_menu-inner-wrap");
			const menuLinks = Array.from(navEl.querySelectorAll(".nav_menu-link"));
			const socials = navEl.querySelector(".nav_socials");

			if (!menuWrap || !menuBg || !menuInner) return;

			open = false;
			astet.navOpen = false;
			document.documentElement.classList.remove("nav-open");
			navBtn.setAttribute("aria-expanded", "false");
			menuWrap.style.display = "none";

			gsap.set([menuBg, menuInner], { autoAlpha: 0 });
			if (menuLinks.length) gsap.set(menuLinks, { autoAlpha: 0 });
			if (socials) gsap.set(socials, { autoAlpha: 0 });

			const tl = gsap.timeline({
				paused: true,
				defaults: { duration: 0.5, ease: "sine.inOut" },
			});

			// Base fade-in
			tl.to([menuBg, menuInner], { autoAlpha: 1, duration: 0.25, ease: "sine.inOut" }, 0);

			// Link stagger + socials fade
			if (menuLinks.length) tl.to(menuLinks, { autoAlpha: 1, duration: 0.25, stagger: 0.03 }, 0.2);
			if (socials) tl.to(socials, { autoAlpha: 1, duration: 0.25 }, 0.22);

			tl.eventCallback("onReverseComplete", () => {
				menuWrap.style.display = "none";
			});

			const onClick = () => {
				console.log("Nav button clicked. Current open state:", open);
				open = !open;
				astet.navOpen = open;
				document.documentElement.classList.toggle("nav-open", open);
				navBtn.setAttribute("aria-expanded", String(open));

				if (open) {
					menuWrap.style.display = "flex";
					tl.play();
				} else {
					tl.reverse();
				}
			};

			navBtn.addEventListener("click", onClick);

			cleanup = () => {
				navBtn.removeEventListener("click", onClick);
				open = false;
				astet.navOpen = false;
				document.documentElement.classList.remove("nav-open");
				navBtn.setAttribute("aria-expanded", "false");
				menuWrap.style.display = "";
				tl.kill();
				gsap.set([menuBg, menuInner], { clearProps: "all" });
				if (menuLinks.length) gsap.set(menuLinks, { clearProps: "all" });
				if (socials) gsap.set(socials, { clearProps: "all" });
				// gsap.set([svgLine1, svgLine2, svgLine3], { clearProps: "all" });
			};
		}

		function teardown() {
			if (!cleanup) return;
			cleanup();
			cleanup = null;
		}

		function syncToBreakpoint() {
			if (!mql || mql.matches) setup();
			else teardown();
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

	astet.hasImagesLoaded = typeof window.imagesLoaded === "function";
	clickToCopy();
	homeCarousel();
	mediaCardHover();
	loadCardsOnScroll();
	finsweetScrollTriggerRefresh();
	navOpenClose();
}

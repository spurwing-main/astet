function main() {
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
	astet.hasImagesLoaded = typeof window.imagesLoaded === "function";
	homeCarousel();
}

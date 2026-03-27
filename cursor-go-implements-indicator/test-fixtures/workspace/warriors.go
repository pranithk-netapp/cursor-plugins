package workspace

type StephCurry struct{ MVPTitles int }
type KlayThompson struct{ Rings int }
type DraymondGreen struct{ Rings int }

func (StephCurry) Shoot() string {
	return "Splash from deep"
}

func (StephCurry) Dribble() string {
	return "Elite handle"
}

func (s StephCurry) Championships() int {
	if s.MVPTitles >= 2 { return 4 }; return 3
}

func (StephCurry) ClutchShot(distanceFeet int) string {
	if distanceFeet >= 30 {
		return "Logo three"
	}
	return "Mid-range dagger"
}

func (KlayThompson) Shoot() string {
	return "Catch and shoot three"
}

func (KlayThompson) Dribble() string {
	return "Controlled dribble"
}

func (k KlayThompson) Championships() int {
	if k.Rings >= 4 { return 4 }; return 3
}

func (KlayThompson) HeatCheck(streak int) bool {
	return streak >= 3
}

func (DraymondGreen) Shoot() string {
	return "Timely corner three"
}

func (DraymondGreen) Dribble() string {
	return "Point-forward push"
}

func (d DraymondGreen) Championships() int {
	if d.Rings >= 4 { return 4 }; return 3
}

func (DraymondGreen) DefensiveImpact(steals int, blocks int) string {
	total := steals + blocks
	if total >= 5 {
		return "Game-changing defense"
	}
	return "Solid defense"
}

// Intentionally left without tests to demonstrate no-coverage lines.
func (DraymondGreen) PodcastEpisodeTitle() string {
	return "The New Media Show"
}

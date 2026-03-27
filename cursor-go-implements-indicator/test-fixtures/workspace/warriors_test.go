package workspace

import "testing"

func TestStephCurryMethods(t *testing.T) {
	t.Parallel()

	player := StephCurry{MVPTitles: 2}
	if got := player.Shoot(); got != "Splash from deep" {
		t.Fatalf("Shoot() = %q, want %q", got, "Splash from deep")
	}
	if got := player.Dribble(); got != "Elite handle" {
		t.Fatalf("Dribble() = %q, want %q", got, "Elite handle")
	}
	if got := player.Championships(); got != 4 {
		t.Fatalf("Championships() = %d, want %d", got, 4)
	}
	// Cover only one branch; the other branch stays uncovered (partial coverage).
	if got := player.ClutchShot(31); got != "Logo three" {
		t.Fatalf("ClutchShot() = %q, want %q", got, "Logo three")
	}
}

func TestKlayThompsonMethods(t *testing.T) {
	t.Parallel()

	player := KlayThompson{Rings: 4}
	if got := player.Shoot(); got != "Catch and shoot three" {
		t.Fatalf("Shoot() = %q, want %q", got, "Catch and shoot three")
	}
	if got := player.Dribble(); got != "Controlled dribble" {
		t.Fatalf("Dribble() = %q, want %q", got, "Controlled dribble")
	}
	if got := player.Championships(); got != 4 {
		t.Fatalf("Championships() = %d, want %d", got, 4)
	}
	if got := player.HeatCheck(4); got != true {
		t.Fatalf("HeatCheck() = %v, want %v", got, true)
	}
}

func TestDraymondGreenMethods(t *testing.T) {
	t.Parallel()

	player := DraymondGreen{Rings: 4}
	if got := player.Shoot(); got != "Timely corner three" {
		t.Fatalf("Shoot() = %q, want %q", got, "Timely corner three")
	}
	if got := player.Dribble(); got != "Point-forward push" {
		t.Fatalf("Dribble() = %q, want %q", got, "Point-forward push")
	}
	if got := player.Championships(); got != 4 {
		t.Fatalf("Championships() = %d, want %d", got, 4)
	}
	// Cover only one branch; the other branch stays uncovered (partial coverage).
	if got := player.DefensiveImpact(3, 2); got != "Game-changing defense" {
		t.Fatalf("DefensiveImpact() = %q, want %q", got, "Game-changing defense")
	}
}

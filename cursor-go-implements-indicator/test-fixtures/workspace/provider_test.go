package workspace

import (
	"context"
	"testing"
)

func TestSnapshotProviders_CreateSnapshot(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		provider SnapshotProvider
		input    string
		want     string
	}{
		{
			name:     "ontap provider",
			provider: OntapProvider{},
			input:    "db",
			want:     "ontap-db",
		},
		{
			name:     "mock provider",
			provider: MockProvider{},
			input:    "cache",
			want:     "mock-cache",
		},
		{
			name:     "sds provider",
			provider: SdsProvider{},
			input:    "logs",
			want:     "sds-logs",
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got, err := tc.provider.CreateSnapshot(context.Background(), tc.input)
			if err != nil {
				t.Fatalf("CreateSnapshot() unexpected error: %v", err)
			}
			if got != tc.want {
				t.Fatalf("CreateSnapshot() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestConcreteTypesImplementSnapshotProvider(t *testing.T) {
	t.Parallel()

	var _ SnapshotProvider = OntapProvider{}
	var _ SnapshotProvider = MockProvider{}
	var _ SnapshotProvider = SdsProvider{}
}

package workspace

import "context"

type SnapshotProvider interface {
	CreateSnapshot(ctx context.Context, name string) (string, error)
}

type OntapProvider struct{}
type MockProvider struct{}
type SdsProvider struct{}

func (o OntapProvider) CreateSnapshot(ctx context.Context, name string) (string, error) {
	return "ontap-" + name, nil
}

func (m MockProvider) CreateSnapshot(ctx context.Context, name string) (string, error) {
	return "mock-" + name, nil
}

func (s SdsProvider) CreateSnapshot(ctx context.Context, name string) (string, error) {
	return "sds-" + name, nil
}

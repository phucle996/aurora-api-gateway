package repo

import "context"

type StorageRepository interface{ Check(context.Context) error }

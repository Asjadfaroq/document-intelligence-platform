namespace DocumentIntelligence.Domain;

public enum UserRole
{
    Owner = 1,
    Admin = 2,
    Member = 3
}

public class Tenant
{
    public Guid Id { get; set; }
    public string Name { get; set; } = default!;
    public string Slug { get; set; } = default!;
    public DateTime CreatedAt { get; set; }

    public ICollection<User> Users { get; set; } = new List<User>();
    public ICollection<Workspace> Workspaces { get; set; } = new List<Workspace>();
}

public class User
{
    public Guid Id { get; set; }
    public string Email { get; set; } = default!;
    public string PasswordHash { get; set; } = default!;
    public UserRole Role { get; set; }
    public DateTime CreatedAt { get; set; }

    public Guid TenantId { get; set; }
    public Tenant Tenant { get; set; } = default!;
}

public class RefreshToken
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public string TokenHash { get; set; } = default!;
    public DateTime ExpiresAtUtc { get; set; }
    public DateTime CreatedAtUtc { get; set; }

    public User User { get; set; } = default!;
}

public class Workspace
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public string Name { get; set; } = default!;
    public string? Description { get; set; }
    public DateTime CreatedAt { get; set; }

    public Tenant Tenant { get; set; } = default!;
}

public enum DocumentStatus
{
    Uploaded = 1,
    Processing = 2,
    Ready = 3,
    Failed = 4
}

public class Document
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid WorkspaceId { get; set; }
    public string FileName { get; set; } = default!;
    public string StoragePath { get; set; } = default!;
    public string? Language { get; set; }
    public DocumentStatus Status { get; set; }
    public DateTime CreatedAt { get; set; }

    public Workspace Workspace { get; set; } = default!;
}

public class DocumentChunk
{
    public Guid Id { get; set; }
    public Guid DocumentId { get; set; }
    public Guid TenantId { get; set; }
    public int PageNumber { get; set; }
    public int ChunkIndex { get; set; }
    public string Content { get; set; } = default!;
    public float[]? Embedding { get; set; }
    public string? MetadataJson { get; set; }

    public Document Document { get; set; } = default!;
}

public class Question
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid WorkspaceId { get; set; }
    public Guid UserId { get; set; }
    public string QuestionText { get; set; } = default!;
    public DateTime CreatedAt { get; set; }
}

public class Answer
{
    public Guid Id { get; set; }
    public Guid QuestionId { get; set; }
    public string AnswerText { get; set; } = default!;
    public string? SourcesJson { get; set; }
    public int LatencyMs { get; set; }
    public string? ModelName { get; set; }
}

public class TenantInvite
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public string Email { get; set; } = default!;
    public string Code { get; set; } = default!;
    public UserRole Role { get; set; }
    public DateTime ExpiresAt { get; set; }
    public DateTime CreatedAt { get; set; }
    public bool IsUsed { get; set; }

    public Tenant Tenant { get; set; } = default!;
}

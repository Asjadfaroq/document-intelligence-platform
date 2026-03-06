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

public class Workspace
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public string Name { get; set; } = default!;
    public string? Description { get; set; }
    public DateTime CreatedAt { get; set; }

    public Tenant Tenant { get; set; } = default!;
}

using DocumentIntelligence.Domain;
using MediatR;

namespace DocumentIntelligence.Application;

public record RegisterTenantAndOwnerCommand(
    string TenantName,
    string TenantSlug,
    string OwnerEmail,
    string OwnerPassword
) : IRequest<AuthResult>;

public record LoginCommand(
    string Email,
    string Password,
    string TenantSlug
) : IRequest<AuthResult>;

public record AuthResult(
    string AccessToken,
    string TenantId,
    string Email,
    string Role
);

public record WorkspaceDto(
    Guid Id,
    string Name,
    string? Description,
    DateTime CreatedAt
);

public record DocumentDto(
    Guid Id,
    Guid WorkspaceId,
    string FileName,
    string StoragePath,
    string? Language,
    DocumentStatus Status,
    DateTime CreatedAt
);

public interface IPasswordHasher
{
    string Hash(string password);
    bool Verify(string password, string hash);
}

public interface IJwtTokenGenerator
{
    string GenerateToken(User user);
}

public interface IApplicationDbContext
{
    IQueryable<Tenant> Tenants { get; }
    IQueryable<User> Users { get; }
    IQueryable<Workspace> Workspaces { get; }
    IQueryable<Document> Documents { get; }

    Task AddAsync<TEntity>(TEntity entity, CancellationToken cancellationToken)
        where TEntity : class;

    Task<int> SaveChangesAsync(CancellationToken cancellationToken);
}

public record GetWorkspacesQuery(Guid TenantId) : IRequest<IReadOnlyList<WorkspaceDto>>;

public record CreateWorkspaceCommand(Guid TenantId, string Name, string? Description) : IRequest<WorkspaceDto>;

public record GetDocumentsQuery(Guid TenantId, Guid WorkspaceId) : IRequest<IReadOnlyList<DocumentDto>>;

public record CreateDocumentCommand(
    Guid TenantId,
    Guid WorkspaceId,
    string FileName,
    string StoragePath,
    string? Language
) : IRequest<DocumentDto>;

public class RegisterTenantAndOwnerCommandHandler : IRequestHandler<RegisterTenantAndOwnerCommand, AuthResult>
{
    private readonly IApplicationDbContext _db;
    private readonly IPasswordHasher _passwordHasher;
    private readonly IJwtTokenGenerator _jwt;

    public RegisterTenantAndOwnerCommandHandler(
        IApplicationDbContext db,
        IPasswordHasher passwordHasher,
        IJwtTokenGenerator jwt)
    {
        _db = db;
        _passwordHasher = passwordHasher;
        _jwt = jwt;
    }

    public async Task<AuthResult> Handle(RegisterTenantAndOwnerCommand request, CancellationToken cancellationToken)
    {
        var tenant = new Tenant
        {
            Id = Guid.NewGuid(),
            Name = request.TenantName,
            Slug = request.TenantSlug,
            CreatedAt = DateTime.UtcNow
        };

        var owner = new User
        {
            Id = Guid.NewGuid(),
            Email = request.OwnerEmail.ToLowerInvariant(),
            PasswordHash = _passwordHasher.Hash(request.OwnerPassword),
            Role = UserRole.Owner,
            TenantId = tenant.Id,
            CreatedAt = DateTime.UtcNow
        };

        var defaultWorkspace = new Workspace
        {
            Id = Guid.NewGuid(),
            Name = "Default",
            Description = "Default workspace",
            TenantId = tenant.Id,
            CreatedAt = DateTime.UtcNow
        };

        await _db.AddAsync(tenant, cancellationToken);
        await _db.AddAsync(owner, cancellationToken);
        await _db.AddAsync(defaultWorkspace, cancellationToken);

        await _db.SaveChangesAsync(cancellationToken);

        var token = _jwt.GenerateToken(owner);

        return new AuthResult(
            token,
            tenant.Id.ToString(),
            owner.Email,
            owner.Role.ToString());
    }
}

public class LoginCommandHandler : IRequestHandler<LoginCommand, AuthResult>
{
    private readonly IApplicationDbContext _db;
    private readonly IPasswordHasher _passwordHasher;
    private readonly IJwtTokenGenerator _jwt;

    public LoginCommandHandler(
        IApplicationDbContext db,
        IPasswordHasher passwordHasher,
        IJwtTokenGenerator jwt)
    {
        _db = db;
        _passwordHasher = passwordHasher;
        _jwt = jwt;
    }

    public async Task<AuthResult> Handle(LoginCommand request, CancellationToken cancellationToken)
    {
        var tenant = _db.Tenants.FirstOrDefault(t => t.Slug == request.TenantSlug);
        if (tenant is null)
        {
            throw new UnauthorizedAccessException("Invalid credentials.");
        }

        var email = request.Email.ToLowerInvariant();
        var user = _db.Users.FirstOrDefault(u => u.TenantId == tenant.Id && u.Email == email);
        if (user is null)
        {
            throw new UnauthorizedAccessException("Invalid credentials.");
        }

        if (!_passwordHasher.Verify(request.Password, user.PasswordHash))
        {
            throw new UnauthorizedAccessException("Invalid credentials.");
        }

        var token = _jwt.GenerateToken(user);

        return new AuthResult(
            token,
            tenant.Id.ToString(),
            user.Email,
            user.Role.ToString());
    }
}

public class GetWorkspacesQueryHandler : IRequestHandler<GetWorkspacesQuery, IReadOnlyList<WorkspaceDto>>
{
    private readonly IApplicationDbContext _db;

    public GetWorkspacesQueryHandler(IApplicationDbContext db)
    {
        _db = db;
    }

    public Task<IReadOnlyList<WorkspaceDto>> Handle(GetWorkspacesQuery request, CancellationToken cancellationToken)
    {
        var workspaces = _db.Workspaces
            .Where(w => w.TenantId == request.TenantId)
            .OrderBy(w => w.CreatedAt)
            .Select(w => new WorkspaceDto(w.Id, w.Name, w.Description, w.CreatedAt))
            .ToList()
            .AsReadOnly();

        return Task.FromResult<IReadOnlyList<WorkspaceDto>>(workspaces);
    }
}

public class CreateWorkspaceCommandHandler : IRequestHandler<CreateWorkspaceCommand, WorkspaceDto>
{
    private readonly IApplicationDbContext _db;

    public CreateWorkspaceCommandHandler(IApplicationDbContext db)
    {
        _db = db;
    }

    public async Task<WorkspaceDto> Handle(CreateWorkspaceCommand request, CancellationToken cancellationToken)
    {
        var workspace = new Workspace
        {
            Id = Guid.NewGuid(),
            TenantId = request.TenantId,
            Name = request.Name,
            Description = request.Description,
            CreatedAt = DateTime.UtcNow
        };

        await _db.AddAsync(workspace, cancellationToken);
        await _db.SaveChangesAsync(cancellationToken);

        return new WorkspaceDto(workspace.Id, workspace.Name, workspace.Description, workspace.CreatedAt);
    }
}

public class GetDocumentsQueryHandler : IRequestHandler<GetDocumentsQuery, IReadOnlyList<DocumentDto>>
{
    private readonly IApplicationDbContext _db;

    public GetDocumentsQueryHandler(IApplicationDbContext db)
    {
        _db = db;
    }

    public Task<IReadOnlyList<DocumentDto>> Handle(GetDocumentsQuery request, CancellationToken cancellationToken)
    {
        var docs = _db.Documents
            .Where(d => d.TenantId == request.TenantId && d.WorkspaceId == request.WorkspaceId)
            .OrderByDescending(d => d.CreatedAt)
            .Select(d => new DocumentDto(
                d.Id,
                d.WorkspaceId,
                d.FileName,
                d.StoragePath,
                d.Language,
                d.Status,
                d.CreatedAt))
            .ToList()
            .AsReadOnly();

        return Task.FromResult<IReadOnlyList<DocumentDto>>(docs);
    }
}

public class CreateDocumentCommandHandler : IRequestHandler<CreateDocumentCommand, DocumentDto>
{
    private readonly IApplicationDbContext _db;

    public CreateDocumentCommandHandler(IApplicationDbContext db)
    {
        _db = db;
    }

    public async Task<DocumentDto> Handle(CreateDocumentCommand request, CancellationToken cancellationToken)
    {
        var document = new Document
        {
            Id = Guid.NewGuid(),
            TenantId = request.TenantId,
            WorkspaceId = request.WorkspaceId,
            FileName = request.FileName,
            StoragePath = request.StoragePath,
            Language = request.Language,
            Status = DocumentStatus.Uploaded,
            CreatedAt = DateTime.UtcNow
        };

        await _db.AddAsync(document, cancellationToken);
        await _db.SaveChangesAsync(cancellationToken);

        return new DocumentDto(
            document.Id,
            document.WorkspaceId,
            document.FileName,
            document.StoragePath,
            document.Language,
            document.Status,
            document.CreatedAt);
    }
}

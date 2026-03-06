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

    Task AddAsync<TEntity>(TEntity entity, CancellationToken cancellationToken)
        where TEntity : class;

    Task<int> SaveChangesAsync(CancellationToken cancellationToken);
}

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

using DocumentIntelligence.Application;
using MediatR;

namespace DocumentIntelligence.Api;

public record RegisterTenantRequest(
    string TenantName,
    string TenantSlug,
    string OwnerEmail,
    string OwnerPassword);

public record LoginRequest(
    string TenantSlug,
    string Email,
    string Password);

public record RefreshRequest(string RefreshToken);

public static class AuthEndpoints
{
    public static IEndpointRouteBuilder MapAuth(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/auth");

        group.MapPost("/register-tenant", async (RegisterTenantRequest request, IMediator mediator, CancellationToken ct) =>
        {
            var command = new RegisterTenantAndOwnerCommand(
                request.TenantName,
                request.TenantSlug,
                request.OwnerEmail,
                request.OwnerPassword);
            var result = await mediator.Send(command, ct);
            return Results.Ok(result);
        });

        group.MapPost("/login", async (LoginRequest request, IMediator mediator, CancellationToken ct) =>
        {
            var command = new LoginCommand(
                request.Email,
                request.Password,
                request.TenantSlug);
            var result = await mediator.Send(command, ct);
            return Results.Ok(result);
        });

        group.MapPost("/refresh", async (RefreshRequest request, IMediator mediator, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(request.RefreshToken))
                return Results.BadRequest("RefreshToken is required.");
            try
            {
                var result = await mediator.Send(new RefreshCommand(request.RefreshToken.Trim()), ct);
                return Results.Ok(result);
            }
            catch (UnauthorizedAccessException)
            {
                return Results.Unauthorized();
            }
        });

        return routes;
    }
}


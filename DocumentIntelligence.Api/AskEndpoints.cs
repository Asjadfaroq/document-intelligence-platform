using System.Security.Claims;
using DocumentIntelligence.Application;
using MediatR;

namespace DocumentIntelligence.Api;

public record AskRequestDto(string Question, int TopK);

public static class AskEndpoints
{
    public static IEndpointRouteBuilder MapAsk(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/workspaces/{workspaceId:guid}/ask")
            .RequireAuthorization();

        group.MapPost(string.Empty, async (
            Guid workspaceId,
            AskRequestDto request,
            ClaimsPrincipal user,
            IMediator mediator,
            CancellationToken ct) =>
        {
            var tenantIdClaim = user.FindFirst("tenantId")?.Value;
            var subClaim = user.FindFirst("sub")?.Value;
            if (!Guid.TryParse(tenantIdClaim, out var tenantId) || !Guid.TryParse(subClaim, out var userId))
            {
                return Results.Unauthorized();
            }

            var topK = request.TopK <= 0 ? 5 : Math.Min(request.TopK, 10);

            var command = new AskQuestionCommand(
                tenantId,
                workspaceId,
                userId,
                request.Question,
                topK);

            var result = await mediator.Send(command, ct);
            return Results.Ok(result);
        });

        return routes;
    }
}


using Awake.Application.Common.Interfaces;
using Awake.Application.Common.Interfaces.Repositories;
using Awake.Application.Common.Models;
using Awake.Domain.Enums;
using MediatR;

namespace Awake.Application.Features.Maps.Commands.DeleteMapLayout;

public class DeleteMapLayoutCommandHandler(
    IMapLayoutRepository layouts,
    ICurrentUserService currentUser)
    : IRequestHandler<DeleteMapLayoutCommand, Result<bool>>
{
    public async Task<Result<bool>> Handle(
        DeleteMapLayoutCommand request, CancellationToken cancellationToken)
    {
        var layout = await layouts.GetByIdAsync(request.Id, cancellationToken);
        if (layout is null)
            return Result<bool>.Failure("Расстановка не найдена.");

        // те же права, что и на изменение: автор либо полковник и выше
        if (layout.AuthorId != currentUser.UserId && currentUser.Rank < UserRank.Colonel)
            return Result<bool>.Failure("Эту расстановку может удалить только её автор.");

        await layouts.RemoveAsync(layout, cancellationToken);
        return Result<bool>.Success(true);
    }
}

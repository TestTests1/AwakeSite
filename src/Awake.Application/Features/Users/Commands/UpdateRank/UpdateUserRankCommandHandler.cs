using Awake.Application.Common.Interfaces;
using Awake.Application.Common.Interfaces.Repositories;
using Awake.Application.Common.Models;
using Awake.Domain.Enums;
using MediatR;

namespace Awake.Application.Features.Users.Commands.UpdateRank;

public class UpdateUserRankCommandHandler(
    IUserRepository userRepository,
    ICurrentUserService currentUser
) : IRequestHandler<UpdateUserRankCommand, Result<Unit>>
{
    public async Task<Result<Unit>> Handle(
        UpdateUserRankCommand request,
        CancellationToken cancellationToken)
    {
        // Ранги — строгая лестница: каждый распоряжается только теми, кто ниже
        // него, и поднимает не выше ступени под собой. Офицер доводит до
        // участника, полковник — до офицера, лидер — до полковника.
        //
        // Правил два, и оба обязательны. Одного потолка мало: без проверки
        // текущего ранга цели полковник разжаловал бы лидера в гости — формально
        // не назначая лидера, а снимая.
        if (request.UserId == currentUser.UserId)
            return Result<Unit>.Failure("Свой ранг менять нельзя.");

        if (request.NewRank >= currentUser.Rank)
            return Result<Unit>.Failure("Выдать можно только ранг ниже собственного.");

        var user = await userRepository.GetByIdAsync(request.UserId, cancellationToken);
        if (user is null)
            return Result<Unit>.Failure("Пользователь не найден.");

        if (user.Rank >= currentUser.Rank)
            return Result<Unit>.Failure("Нельзя менять ранг равного или старшего по рангу.");

        user.Rank = request.NewRank;
        await userRepository.UpdateAsync(user, cancellationToken);

        return Result<Unit>.Success(Unit.Value);
    }
}
